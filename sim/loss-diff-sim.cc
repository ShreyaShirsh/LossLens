/*
 * Loss-differentiation testbed.
 *
 *   sender ───access──┐                       ┌──wireless (lossy)── receiver
 *                     router ══bottleneck══ ap
 *   crossSrc ─access──┘                       └──access── crossSink
 *
 * Congestion drops: FIFO queue disc on router -> ap   ("Drop" trace)
 * Random drops:     RateErrorModel on the receiver     ("PhyRxDrop" trace)
 *
 * Every dropped data segment of a monitored flow is recorded in GroundTruth.
 * With --tcp=TcpLossAware, one CSV row is written per loss event
 * (features + true label) for training. Every run also writes a summary CSV
 * (goodput, RTT, drops) for evaluation. Formats: docs/interfaces.md.
 */

#include "ground-truth.h"
#include "tcp-loss-aware.h"

#include "ns3/applications-module.h"
#include "ns3/core-module.h"
#include "ns3/internet-module.h"
#include "ns3/network-module.h"
#include "ns3/point-to-point-module.h"
#include "ns3/ppp-header.h"
#include "ns3/traffic-control-module.h"

#include <algorithm>
#include <filesystem>
#include <fstream>
#include <map>
#include <sstream>
#include <vector>

using namespace ns3;

NS_LOG_COMPONENT_DEFINE("LossDiffSim");

namespace
{

struct SimParams
{
    std::string tcp = "TcpLossAware";
    std::string classifier = "cubic";
    double bwMbps = 100;    // bottleneck rate
    double rttMs = 50;      // base (propagation) RTT
    double randLoss = 0.01; // packet error rate on the wireless hop
    double bufferBdp = 1.0; // bottleneck buffer, in multiples of the BDP
    uint32_t flows = 1;     // monitored flows (sender -> receiver)
    double crossLoad = 0.3; // average UDP on/off cross traffic, fraction of bottleneck
    uint32_t crossTcp = 0;  // competing CUBIC flows (crossSrc -> crossSink)
    double duration = 20;   // seconds
    uint32_t seed = 1;      // RNG run number
    std::string outDir = "results";
    bool logFeatures = true;
    bool traceTs = false;

    std::string RunTag() const
    {
        std::ostringstream s;
        s << tcp;
        if (tcp == "TcpLossAware")
        {
            s << '-' << classifier;
        }
        s << "_bw" << bwMbps << "_rtt" << rttMs << "_loss" << randLoss << "_buf" << bufferBdp
          << "_f" << flows << "_x" << crossLoad << "_t" << crossTcp << "_s" << seed;
        return s.str();
    }

    static std::string MetaHeader()
    {
        return "meta_run_tag,meta_tcp,meta_classifier,meta_bw_mbps,meta_rtt_ms,meta_rand_loss,"
               "meta_buffer_bdp,meta_flows,meta_cross_load,meta_cross_tcp,meta_seed";
    }

    std::string MetaCsv() const
    {
        std::ostringstream s;
        s << RunTag() << ',' << tcp << ',' << (tcp == "TcpLossAware" ? classifier : "") << ','
          << bwMbps << ',' << rttMs << ',' << randLoss << ',' << bufferBdp << ',' << flows << ','
          << crossLoad << ',' << crossTcp << ',' << seed;
        return s.str();
    }
};

struct FlowState
{
    uint32_t id{0};
    uint16_t port{0};
    double startTime{0};
    Ptr<PacketSink> sink;
    SequenceNumber32 highTx;
    SequenceNumber32 recoveryPoint;
    uint32_t lossEvents{0};
    uint32_t cwnd{0};
    double lastRttMs{0};
    std::vector<double> rttMs;
};

SimParams g_params;
std::string g_meta;
Ipv4Address g_senderAddr;
std::map<uint16_t, uint32_t> g_portToFlow;
// Monitored flow i and competing CUBIC flow j start at kFirstStart + 0.1 i (or j).
constexpr double kFirstStart = 0.5;

std::vector<FlowState> g_flows;
std::vector<Ptr<PacketSink>> g_crossSinks; // competing CUBIC flows, for fairness
std::ofstream g_featureCsv;
std::ofstream g_tsCsv;

/// Minimal bulk sender that uses a socket we created ourselves, so we can
/// install our own congestion control object on it before it connects.
class BulkFlow : public Application
{
  public:
    static TypeId GetTypeId()
    {
        static TypeId tid =
            TypeId("LossDiffBulkFlow").SetParent<Application>().AddConstructor<BulkFlow>();
        return tid;
    }

    void Setup(Ptr<Socket> socket, Address peer)
    {
        m_socket = socket;
        m_peer = peer;
    }

  private:
    void StartApplication() override
    {
        m_socket->SetConnectCallback(MakeCallback(&BulkFlow::Connected, this),
                                     MakeNullCallback<void, Ptr<Socket>>());
        m_socket->SetSendCallback(MakeCallback(&BulkFlow::Fill, this));
        m_socket->Connect(m_peer);
    }

    void StopApplication() override
    {
        if (m_socket)
        {
            m_socket->Close();
        }
    }

    void Connected(Ptr<Socket> s)
    {
        Fill(s, s->GetTxAvailable());
    }

    void Fill(Ptr<Socket> s, uint32_t /* available */)
    {
        while (s->GetTxAvailable() > 0)
        {
            uint32_t n = std::min<uint32_t>(s->GetTxAvailable(), 64 * 1024);
            if (s->Send(Create<Packet>(n)) < 0)
            {
                break;
            }
        }
    }

    Ptr<Socket> m_socket;
    Address m_peer;
};

// ---------------------------------------------------------------- drop labelling

/// p must start at the TCP header.
void
RecordTcpDrop(Ptr<Packet> p, const Ipv4Header& ip, LossType type)
{
    constexpr uint8_t kIpProtoTcp = 6; // IANA protocol number for TCP
    if (ip.GetProtocol() != kIpProtoTcp || ip.GetSource() != g_senderAddr)
    {
        return;
    }
    TcpHeader th;
    p->PeekHeader(th);
    if (p->GetSize() <= th.GetSerializedSize())
    {
        return; // no payload: SYN / pure ACK / FIN
    }
    auto it = g_portToFlow.find(th.GetSourcePort());
    if (it == g_portToFlow.end())
    {
        return;
    }
    GroundTruth::Get().RecordDrop(it->second, th.GetSequenceNumber(), type);
}

void
OnQueueDrop(Ptr<const QueueDiscItem> item)
{
    auto ipItem = DynamicCast<const Ipv4QueueDiscItem>(item);
    if (ipItem)
    {
        RecordTcpDrop(item->GetPacket()->Copy(), ipItem->GetHeader(), LossType::CONGESTION);
    }
}

void
OnWirelessDrop(Ptr<const Packet> pkt)
{
    Ptr<Packet> p = pkt->Copy();
    PppHeader ppp;
    p->RemoveHeader(ppp);
    if (ppp.GetProtocol() != 0x0021) // IPv4
    {
        return;
    }
    Ipv4Header ip;
    p->RemoveHeader(ip);
    RecordTcpDrop(p, ip, LossType::RANDOM);
}

// ---------------------------------------------------------------- socket traces

void
OnHighTx(uint32_t flowId, SequenceNumber32 /* old */, SequenceNumber32 v)
{
    g_flows[flowId].highTx = v;
}

void
OnCongState(uint32_t flowId,
            TcpSocketState::TcpCongState_t oldState,
            TcpSocketState::TcpCongState_t newState)
{
    FlowState& fs = g_flows[flowId];
    bool lossState =
        newState == TcpSocketState::CA_RECOVERY || newState == TcpSocketState::CA_LOSS;
    if (lossState && oldState != newState)
    {
        fs.recoveryPoint = fs.highTx; // everything sent so far belongs to this event
        fs.lossEvents++;
    }
    if (newState == TcpSocketState::CA_OPEN)
    {
        // Recovery finished: drops inside it are not new loss events.
        GroundTruth::Get().ClearBelow(flowId, fs.recoveryPoint);
    }
}

void
OnCwnd(uint32_t flowId, uint32_t /* old */, uint32_t v)
{
    g_flows[flowId].cwnd = v;
}

void
OnRtt(uint32_t flowId, Time /* old */, Time v)
{
    FlowState& fs = g_flows[flowId];
    fs.lastRttMs = v.GetSeconds() * 1000.0;
    if (fs.lastRttMs > 0)
    {
        fs.rttMs.push_back(fs.lastRttMs);
    }
}

/// One training row per loss event (only for TcpLossAware).
void
OnLossEvent(const LossEventInfo& e)
{
    if (!g_featureCsv.is_open())
    {
        return;
    }
    GroundTruth::Counts pending = GroundTruth::Get().Pending(e.flowId);
    int label = pending.congestion > 0 ? 1 : (pending.random > 0 ? 0 : -1);
    g_featureCsv << g_meta << ',' << e.time.GetSeconds() << ',' << e.flowId << ',' << e.eventId
                 << ',' << e.isRto << ',' << e.features.ToCsv() << ',' << pending.congestion << ','
                 << pending.random << ',' << label << ',' << e.predictedCongestion << '\n';
}

void
SampleTimeSeries()
{
    double now = Simulator::Now().GetSeconds();
    for (const FlowState& fs : g_flows)
    {
        g_tsCsv << now << ',' << fs.id << ',' << fs.cwnd << ',' << fs.lastRttMs << '\n';
    }
    Simulator::Schedule(MilliSeconds(10), &SampleTimeSeries);
}

// ---------------------------------------------------------------- helpers

std::string
Rate(double mbps)
{
    std::ostringstream s;
    s << mbps << "Mbps";
    return s.str();
}

double
Percentile(std::vector<double> v, double q)
{
    if (v.empty())
    {
        return 0.0;
    }
    std::size_t k = static_cast<std::size_t>(q * (v.size() - 1));
    std::nth_element(v.begin(), v.begin() + k, v.end());
    return v[k];
}

void
WriteSummary(const std::string& path)
{
    const SimParams& P = g_params;
    std::vector<double> goodput;
    for (const FlowState& fs : g_flows)
    {
        double active = std::max(1e-9, P.duration - fs.startTime);
        goodput.push_back(fs.sink->GetTotalRx() * 8.0 / active / 1e6);
    }
    double sum = 0.0;
    double sumSq = 0.0;
    for (double g : goodput)
    {
        sum += g;
        sumSq += g * g;
    }
    double jain = sumSq > 0 ? (sum * sum) / (goodput.size() * sumSq) : 0.0;

    // Mean goodput of the competing CUBIC flows (same on every row).
    double crossTcp = 0.0;
    for (std::size_t j = 0; j < g_crossSinks.size(); ++j)
    {
        double active = std::max(1e-9, P.duration - (kFirstStart + 0.1 * j));
        crossTcp += g_crossSinks[j]->GetTotalRx() * 8.0 / active / 1e6;
    }
    crossTcp = g_crossSinks.empty() ? 0.0 : crossTcp / g_crossSinks.size();

    std::ofstream out(path);
    out << SimParams::MetaHeader()
        << ",flow_id,goodput_mbps,mean_rtt_ms,p95_rtt_ms,loss_events,cong_drops,rand_drops,jain,"
           "cross_tcp_mbps\n";
    for (const FlowState& fs : g_flows)
    {
        double meanRtt = 0.0;
        for (double r : fs.rttMs)
        {
            meanRtt += r;
        }
        meanRtt = fs.rttMs.empty() ? 0.0 : meanRtt / fs.rttMs.size();
        GroundTruth::Counts drops = GroundTruth::Get().Totals(fs.id);
        out << g_meta << ',' << fs.id << ',' << goodput[fs.id] << ',' << meanRtt << ','
            << Percentile(fs.rttMs, 0.95) << ',' << fs.lossEvents << ',' << drops.congestion << ','
            << drops.random << ',' << jain << ',' << crossTcp << '\n';
        std::cout << "flow " << fs.id << ": " << goodput[fs.id] << " Mbps, mean RTT " << meanRtt
                  << " ms, loss events " << fs.lossEvents << ", drops (cong/rand) "
                  << drops.congestion << '/' << drops.random << '\n';
    }
}

} // namespace

int
main(int argc, char* argv[])
{
    SimParams& P = g_params;
    CommandLine cmd(__FILE__);
    cmd.AddValue("tcp",
                 "TcpLossAware, TcpCubic, TcpNewReno, TcpWestwoodPlus, TcpVeno, TcpBbr, ...",
                 P.tcp);
    cmd.AddValue("classifier", "TcpLossAware mode: cubic | oracle | tree", P.classifier);
    cmd.AddValue("bw", "Bottleneck rate (Mbps)", P.bwMbps);
    cmd.AddValue("rtt", "Base RTT (ms)", P.rttMs);
    cmd.AddValue("loss", "Random packet loss rate on the wireless hop (0..1)", P.randLoss);
    cmd.AddValue("buffer", "Bottleneck buffer in multiples of the BDP", P.bufferBdp);
    cmd.AddValue("flows", "Number of monitored flows", P.flows);
    cmd.AddValue("crossLoad", "Average UDP on/off cross traffic (fraction of bw)", P.crossLoad);
    cmd.AddValue("crossTcp", "Number of competing CUBIC flows", P.crossTcp);
    cmd.AddValue("duration", "Simulation time (s)", P.duration);
    cmd.AddValue("seed", "RNG run number", P.seed);
    cmd.AddValue("outDir", "Output directory", P.outDir);
    cmd.AddValue("logFeatures", "Write per-loss-event features (TcpLossAware only)", P.logFeatures);
    cmd.AddValue("traceTs", "Write a cwnd/RTT time series every 10 ms", P.traceTs);
    cmd.Parse(argc, argv);

    RngSeedManager::SetSeed(1);
    RngSeedManager::SetRun(P.seed);
    g_meta = P.MetaCsv();

    TypeId tcpTid;
    NS_ABORT_MSG_UNLESS(TypeId::LookupByNameFailSafe("ns3::" + P.tcp, &tcpTid),
                        "Unknown TCP variant ns3::" << P.tcp);
    bool lossAware = (tcpTid == TcpLossAware::GetTypeId());

    // ---- sizes derived from the scenario
    double bdpBytes = P.bwMbps * 1e6 / 8.0 * P.rttMs / 1e3;
    auto bufPkts = std::max<uint32_t>(10, static_cast<uint32_t>(P.bufferBdp * bdpBytes / 1500));
    auto sockBuf = std::max<uint32_t>(1 << 17, static_cast<uint32_t>(4 * bdpBytes));

    Config::SetDefault("ns3::TcpSocket::SegmentSize", UintegerValue(1448));
    Config::SetDefault("ns3::TcpSocket::SndBufSize", UintegerValue(sockBuf));
    Config::SetDefault("ns3::TcpSocket::RcvBufSize", UintegerValue(sockBuf));
    Config::SetDefault("ns3::TcpSocket::InitialCwnd", UintegerValue(10));
    // Default for every socket not created below (receiver side, cross traffic).
    Config::SetDefault("ns3::TcpL4Protocol::SocketType", TypeIdValue(TcpCubic::GetTypeId()));
    if (P.tcp == "TcpBbr")
    {
        Config::SetDefault("ns3::TcpSocketState::EnablePacing", BooleanValue(true));
    }

    // ---- topology
    NodeContainer nodes;
    nodes.Create(6);
    Ptr<Node> sender = nodes.Get(0);
    Ptr<Node> crossSrc = nodes.Get(1);
    Ptr<Node> router = nodes.Get(2);
    Ptr<Node> ap = nodes.Get(3);
    Ptr<Node> receiver = nodes.Get(4);
    Ptr<Node> crossSink = nodes.Get(5);

    const double edgeDelayMs = 1.0;
    const double bottleneckDelayMs = std::max(0.5, P.rttMs / 2.0 - 2 * edgeDelayMs);

    PointToPointHelper access;
    access.SetDeviceAttribute("DataRate", StringValue(Rate(10 * P.bwMbps)));
    access.SetChannelAttribute("Delay", TimeValue(Seconds(edgeDelayMs / 1000.0)));

    PointToPointHelper bottleneck;
    bottleneck.SetDeviceAttribute("DataRate", StringValue(Rate(P.bwMbps)));
    bottleneck.SetChannelAttribute("Delay", TimeValue(Seconds(bottleneckDelayMs / 1000.0)));
    bottleneck.SetQueue("ns3::DropTailQueue", "MaxSize", StringValue("1p")); // queue in the qdisc

    // Faster than the bottleneck, so it never queues: its only losses are random.
    PointToPointHelper wireless;
    wireless.SetDeviceAttribute("DataRate", StringValue(Rate(2 * P.bwMbps)));
    wireless.SetChannelAttribute("Delay", TimeValue(Seconds(edgeDelayMs / 1000.0)));

    NetDeviceContainer dSender = access.Install(sender, router);
    NetDeviceContainer dCross = access.Install(crossSrc, router);
    NetDeviceContainer dBottleneck = bottleneck.Install(router, ap);
    NetDeviceContainer dWireless = wireless.Install(ap, receiver);
    NetDeviceContainer dCrossSink = access.Install(ap, crossSink);

    InternetStackHelper stack;
    stack.InstallAll();

    // Bottleneck queue (installed before addressing, so the default qdisc is not used).
    TrafficControlHelper tch;
    tch.SetRootQueueDisc("ns3::FifoQueueDisc",
                         "MaxSize",
                         QueueSizeValue(QueueSize(QueueSizeUnit::PACKETS, bufPkts)));
    QueueDiscContainer qdiscs = tch.Install(dBottleneck.Get(0));
    qdiscs.Get(0)->TraceConnectWithoutContext("Drop", MakeCallback(&OnQueueDrop));

    // Random loss on the wireless hop (data direction only).
    Ptr<RateErrorModel> em = CreateObject<RateErrorModel>();
    em->SetUnit(RateErrorModel::ERROR_UNIT_PACKET);
    em->SetRate(P.randLoss);
    dWireless.Get(1)->SetAttribute("ReceiveErrorModel", PointerValue(em));
    dWireless.Get(1)->TraceConnectWithoutContext("PhyRxDrop", MakeCallback(&OnWirelessDrop));

    Ipv4AddressHelper addr;
    addr.SetBase("10.1.1.0", "255.255.255.0");
    Ipv4InterfaceContainer iSender = addr.Assign(dSender);
    addr.SetBase("10.1.2.0", "255.255.255.0");
    addr.Assign(dCross);
    addr.SetBase("10.1.3.0", "255.255.255.0");
    addr.Assign(dBottleneck);
    addr.SetBase("10.1.4.0", "255.255.255.0");
    Ipv4InterfaceContainer iWireless = addr.Assign(dWireless);
    addr.SetBase("10.1.5.0", "255.255.255.0");
    Ipv4InterfaceContainer iCrossSink = addr.Assign(dCrossSink);
    Ipv4GlobalRoutingHelper::PopulateRoutingTables();

    g_senderAddr = iSender.GetAddress(0);
    Ipv4Address receiverAddr = iWireless.GetAddress(1);
    Ipv4Address crossSinkAddr = iCrossSink.GetAddress(1);

    // ---- output files
    std::filesystem::create_directories(P.outDir);
    const std::string tag = P.RunTag();
    if (lossAware && P.logFeatures)
    {
        g_featureCsv.open(P.outDir + "/features_" + tag + ".csv");
        g_featureCsv << SimParams::MetaHeader() << ",time,flow_id,event_id,is_rto,"
                     << LossFeatures::CsvHeader()
                     << ",n_cong_drops,n_rand_drops,label,predicted\n";
    }

    // ---- monitored flows
    g_flows.resize(P.flows);
    for (uint32_t i = 0; i < P.flows; ++i)
    {
        uint16_t sinkPort = 5000 + i;
        PacketSinkHelper sinkHelper("ns3::TcpSocketFactory",
                                    InetSocketAddress(Ipv4Address::GetAny(), sinkPort));
        ApplicationContainer sinkApp = sinkHelper.Install(receiver);
        sinkApp.Start(Seconds(0.0));

        Ptr<Socket> sock = Socket::CreateSocket(sender, TcpSocketFactory::GetTypeId());
        Ptr<TcpSocketBase> tcpSock = DynamicCast<TcpSocketBase>(sock);

        ObjectFactory ccFactory;
        ccFactory.SetTypeId(tcpTid);
        if (lossAware)
        {
            ccFactory.Set("Classifier", StringValue(P.classifier));
            ccFactory.Set("FlowId", UintegerValue(i));
        }
        Ptr<TcpCongestionOps> algo = ccFactory.Create<TcpCongestionOps>();
        tcpSock->SetCongestionControlAlgorithm(algo);
        if (lossAware)
        {
            algo->TraceConnectWithoutContext("LossEvent", MakeCallback(&OnLossEvent));
        }

        // Bind now so we know the source port used to match dropped packets.
        sock->Bind();
        Address local;
        sock->GetSockName(local);
        uint16_t port = InetSocketAddress::ConvertFrom(local).GetPort();
        g_portToFlow[port] = i;

        FlowState& fs = g_flows[i];
        fs.id = i;
        fs.port = port;
        fs.startTime = kFirstStart + 0.1 * i;
        fs.sink = DynamicCast<PacketSink>(sinkApp.Get(0));

        sock->TraceConnectWithoutContext("HighestSequence", MakeBoundCallback(&OnHighTx, i));
        sock->TraceConnectWithoutContext("CongState", MakeBoundCallback(&OnCongState, i));
        sock->TraceConnectWithoutContext("CongestionWindow", MakeBoundCallback(&OnCwnd, i));
        sock->TraceConnectWithoutContext("RTT", MakeBoundCallback(&OnRtt, i));

        Ptr<BulkFlow> app = CreateObject<BulkFlow>();
        app->Setup(sock, InetSocketAddress(receiverAddr, sinkPort));
        sender->AddApplication(app);
        app->SetStartTime(Seconds(fs.startTime));
        app->SetStopTime(Seconds(P.duration));
    }

    // ---- cross traffic: bursty UDP. ON bursts run at 80% of the bottleneck (never
    // more, or TCP is simply starved); the ON share of each ~1 s cycle sets the
    // average load.
    if (P.crossLoad > 0)
    {
        const double onShareOfLink = 0.8;
        NS_ABORT_MSG_UNLESS(P.crossLoad < onShareOfLink,
                            "--crossLoad must be below " << onShareOfLink);
        const double duty = P.crossLoad / onShareOfLink;
        const uint16_t port = 9000;
        PacketSinkHelper udpSink("ns3::UdpSocketFactory",
                                 InetSocketAddress(Ipv4Address::GetAny(), port));
        udpSink.Install(crossSink).Start(Seconds(0.0));

        OnOffHelper onoff("ns3::UdpSocketFactory", InetSocketAddress(crossSinkAddr, port));
        onoff.SetConstantRate(DataRate(Rate(onShareOfLink * P.bwMbps)), 1400);
        std::ostringstream onTime;
        std::ostringstream offTime;
        onTime << "ns3::ExponentialRandomVariable[Mean=" << duty << "]";
        offTime << "ns3::ExponentialRandomVariable[Mean=" << 1.0 - duty << "]";
        onoff.SetAttribute("OnTime", StringValue(onTime.str()));
        onoff.SetAttribute("OffTime", StringValue(offTime.str()));
        ApplicationContainer a = onoff.Install(crossSrc);
        a.Start(Seconds(1.0));
        a.Stop(Seconds(P.duration));
    }

    // ---- cross traffic: competing CUBIC flows
    for (uint32_t j = 0; j < P.crossTcp; ++j)
    {
        uint16_t port = 7000 + j;
        PacketSinkHelper s("ns3::TcpSocketFactory", InetSocketAddress(Ipv4Address::GetAny(), port));
        ApplicationContainer sinkApp = s.Install(crossSink);
        sinkApp.Start(Seconds(0.0));
        g_crossSinks.push_back(DynamicCast<PacketSink>(sinkApp.Get(0)));

        BulkSendHelper b("ns3::TcpSocketFactory", InetSocketAddress(crossSinkAddr, port));
        b.SetAttribute("MaxBytes", UintegerValue(0));
        ApplicationContainer a = b.Install(crossSrc);
        a.Start(Seconds(kFirstStart + 0.1 * j)); // same start as our flows: a fair race
        a.Stop(Seconds(P.duration));
    }

    if (P.traceTs)
    {
        g_tsCsv.open(P.outDir + "/ts_" + tag + ".csv");
        g_tsCsv << "time,flow_id,cwnd_bytes,rtt_ms\n";
        Simulator::Schedule(Seconds(0.5), &SampleTimeSeries);
    }

    std::cout << "Running " << tag << " (buffer " << bufPkts << " pkts)\n";
    Simulator::Stop(Seconds(P.duration + 0.5));
    Simulator::Run();

    WriteSummary(P.outDir + "/summary_" + tag + ".csv");
    g_featureCsv.close();
    g_tsCsv.close();
    Simulator::Destroy();
    return 0;
}
