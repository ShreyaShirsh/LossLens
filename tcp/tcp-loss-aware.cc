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
            .AddAttribute("FallbackSrttRatio",
                          "Smoothed RTT / min RTT above which the safety fallback "
                          "considers a queue to be building",
                          DoubleValue(1.2),
                          MakeDoubleAccessor(&TcpLossAware::m_fallbackSrttRatio),
                          MakeDoubleChecker<double>(1.0))
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
      m_maxConsecutiveRandom(sock.m_maxConsecutiveRandom),
      m_fallbackSrttRatio(sock.m_fallbackSrttRatio)
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
    // TODO: check in tcp-socket-base.cc whether `rtt` is a fresh sample
    // for every call or the last known value; if repeated, skip duplicates here.
    m_features.OnAck(Simulator::Now(), segmentsAcked * tcb->m_segmentSize, rtt);

    // While recovering from a random loss, keep growing. ns-3 does not call
    // IncreaseWindow() during recovery, and at ~1% loss TCP is recovering most
    // of the time, so the window would stall. PRR lets the sender fill up to
    // ssthresh, and cwnd = ssthresh when recovery ends, so we grow ssthresh at
    // CUBIC's own congestion-avoidance pace (never slow start: HyStart can't
    // protect us inside recovery).
    if (m_restoreSsThresh && tcb->m_congState == TcpSocketState::CA_RECOVERY &&
        segmentsAcked > 0)
    {
        uint32_t cwnd = tcb->m_cWnd.Get();
        tcb->m_cWnd = tcb->m_ssThresh.Get(); // cwnd == ssthresh: CUBIC takes its CA branch
        TcpCubic::IncreaseWindow(tcb, segmentsAcked);
        tcb->m_ssThresh = tcb->m_cWnd.Get();
        tcb->m_cWnd = cwnd;
    }
}

void
TcpLossAware::CongestionStateSet(Ptr<TcpSocketState> tcb,
                                 const TcpSocketState::TcpCongState_t newState)
{
    TcpCubic::CongestionStateSet(tcb, newState);
    // ns-3 calls this before GetSsThresh() when entering CA_RECOVERY / CA_LOSS,
    // so m_lastState tells GetSsThresh() whether the event is a timeout.
    // TODO: confirm this order for your ns-3 version.
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

    // Safety fallback for the trained classifier: several "random" decisions in
    // a row while a queue is clearly building (RTT well above its minimum and
    // still rising) means the classifier is probably wrong. A rising RTT alone
    // is not enough: jitter makes it "rise" about half the time.
    // The oracle is ground truth, so it is never overruled.
    if (!congestion && m_classifier == "tree")
    {
        m_consecutiveRandom++;
        if (m_consecutiveRandom > m_maxConsecutiveRandom &&
            info.features.srtt_ratio > m_fallbackSrttRatio && info.features.rtt_gradient > 0.0)
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
        m_restoreSsThresh = false;
        return TcpCubic::GetSsThresh(tcb, bytesInFlight);
    }
    // Random loss: keep (most of) the window. ns-3 sets cwnd = ssthresh when
    // recovery ends, so ssthresh must be about cwnd here; the pre-loss value is
    // put back afterwards (IncreaseWindow) so slow start can continue.
    // TODO: TcpCubic's internal state (W_max, epoch) is not updated on
    // this path; check that the window growth afterwards behaves sensibly.
    if (!m_restoreSsThresh)
    {
        m_savedSsThresh = tcb->m_ssThresh.Get();
        m_restoreSsThresh = true;
    }
    uint32_t target = static_cast<uint32_t>(tcb->m_cWnd.Get() * m_randomLossBeta);
    return std::max(target, 2 * tcb->m_segmentSize);
}

void
TcpLossAware::IncreaseWindow(Ptr<TcpSocketState> tcb, uint32_t segmentsAcked)
{
    if (m_restoreSsThresh && tcb->m_congState == TcpSocketState::CA_OPEN)
    {
        // Recovery from a random loss is over: forget it happened.
        tcb->m_ssThresh = std::max(m_savedSsThresh, tcb->m_ssThresh.Get());
        m_restoreSsThresh = false;
    }
    TcpCubic::IncreaseWindow(tcb, segmentsAcked);
}

Ptr<TcpCongestionOps>
TcpLossAware::Fork()
{
    return CopyObject<TcpLossAware>(this);
}

} // namespace ns3
