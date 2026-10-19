#include "tcp-loss-aware.h"

#include "ground-truth.h"
#include "loss-classifier.h"

#include "ns3/abort.h"
#include "ns3/double.h"
#include "ns3/log.h"
#include "ns3/simulator.h"
#include "ns3/string.h"
#include "ns3/uinteger.h"

#include <algorithm>

namespace ns3
{

NS_LOG_COMPONENT_DEFINE("TcpLossAware");
NS_OBJECT_ENSURE_REGISTERED(TcpLossAware);

TypeId
TcpLossAware::GetTypeId()
{
    static TypeId tid =
        TypeId("ns3::TcpLossAware")
            .SetParent<TcpCubic>()
            .SetGroupName("Internet")
            .AddConstructor<TcpLossAware>()
            .AddAttribute("Classifier",
                          "How loss events are classified: cubic, oracle or tree",
                          StringValue("cubic"),
                          MakeStringAccessor(&TcpLossAware::m_classifier),
                          MakeStringChecker())
            .AddAttribute("FlowId",
                          "Flow index used for logging and the oracle",
                          UintegerValue(0),
                          MakeUintegerAccessor(&TcpLossAware::m_flowId),
                          MakeUintegerChecker<uint32_t>())
            .AddAttribute("RandomLossBeta",
                          "Window multiplier for losses classified as random (1.0 = keep cwnd)",
                          DoubleValue(1.0),
                          MakeDoubleAccessor(&TcpLossAware::m_randomLossBeta),
                          MakeDoubleChecker<double>(0.5, 1.0))
            .AddAttribute("MaxConsecutiveRandom",
                          "Random-loss decisions in a row after which a rising RTT "
                          "forces a congestion response (safety fallback)",
                          UintegerValue(3),
                          MakeUintegerAccessor(&TcpLossAware::m_maxConsecutiveRandom),
                          MakeUintegerChecker<uint32_t>())
            .AddTraceSource("LossEvent",
                            "Fired once per loss event with its features and the decision",
                            MakeTraceSourceAccessor(&TcpLossAware::m_lossEventTrace),
                            "ns3::TcpLossAware::LossEventTracedCallback");
    return tid;
}

TcpLossAware::TcpLossAware()
    : TcpCubic()
{
    NS_LOG_FUNCTION(this);
}

TcpLossAware::TcpLossAware(const TcpLossAware& sock)
    : TcpCubic(sock),
      m_classifier(sock.m_classifier),
      m_flowId(sock.m_flowId),
      m_randomLossBeta(sock.m_randomLossBeta),
      m_maxConsecutiveRandom(sock.m_maxConsecutiveRandom)
{
    NS_LOG_FUNCTION(this);
}

std::string
TcpLossAware::GetName() const
{
    return "TcpLossAware";
}

void
TcpLossAware::PktsAcked(Ptr<TcpSocketState> tcb, uint32_t segmentsAcked, const Time& rtt)
{
    TcpCubic::PktsAcked(tcb, segmentsAcked, rtt);
    // TODO(Member 3): check in tcp-socket-base.cc whether `rtt` is a fresh sample
    // for every call or the last known value; if repeated, skip duplicates here.
    m_features.OnAck(Simulator::Now(), segmentsAcked * tcb->m_segmentSize, rtt);
}

void
TcpLossAware::CongestionStateSet(Ptr<TcpSocketState> tcb,
                                 const TcpSocketState::TcpCongState_t newState)
{
    TcpCubic::CongestionStateSet(tcb, newState);
    // ns-3 calls this before GetSsThresh() when entering CA_RECOVERY / CA_LOSS,
    // so m_lastState tells GetSsThresh() whether the event is a timeout.
    // TODO(Member 3): confirm this order for your ns-3 version.
    m_lastState = newState;
}

bool
TcpLossAware::Classify(const LossFeatures& f) const
{
    if (m_classifier == "cubic")
    {
        return true;
    }
    if (m_classifier == "oracle")
    {
        GroundTruth::Counts pending = GroundTruth::Get().Pending(m_flowId);
        // Unknown cause (no recorded drop) is treated as congestion, the safe choice.
        return pending.congestion > 0 || pending.random == 0;
    }
    if (m_classifier == "tree")
    {
        return IsCongestionLossTree(f);
    }
    NS_ABORT_MSG("Unknown TcpLossAware classifier: " << m_classifier);
    return true;
}

uint32_t
TcpLossAware::GetSsThresh(Ptr<const TcpSocketState> tcb, uint32_t bytesInFlight)
{
    Time now = Simulator::Now();

    LossEventInfo info;
    info.flowId = m_flowId;
    info.eventId = m_eventId++;
    info.time = now;
    info.isRto = (m_lastState == TcpSocketState::CA_LOSS);
    info.recoveryPoint = tcb->m_highTxMark.Get();
    info.features = m_features.Compute(now, tcb->m_cWnd.Get());

    // Timeouts are always treated as congestion.
    bool congestion = info.isRto || Classify(info.features);

    // Safety fallback: several "random" decisions in a row while RTT keeps
    // rising probably means the classifier is wrong and a queue is building.
    // TODO(Member 3): tune this rule in week 4.
    if (!congestion)
    {
        m_consecutiveRandom++;
        if (m_consecutiveRandom > m_maxConsecutiveRandom && info.features.rtt_gradient > 0.0)
        {
            congestion = true;
        }
    }
    if (congestion)
    {
        m_consecutiveRandom = 0;
    }

    info.predictedCongestion = congestion;
    m_lossEventTrace(info);
    m_features.OnLossEvent(now, tcb->m_segmentSize);

    if (congestion)
    {
        return TcpCubic::GetSsThresh(tcb, bytesInFlight);
    }
    // Random loss: keep (most of) the window.
    // TODO(Member 3): TcpCubic's internal state (W_max, epoch) is not updated on
    // this path; check that the window growth afterwards behaves sensibly.
    uint32_t target = static_cast<uint32_t>(tcb->m_cWnd.Get() * m_randomLossBeta);
    return std::max(target, 2 * tcb->m_segmentSize);
}

Ptr<TcpCongestionOps>
TcpLossAware::Fork()
{
    return CopyObject<TcpLossAware>(this);
}

} // namespace ns3
