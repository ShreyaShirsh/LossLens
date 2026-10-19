// TcpLossAware: CUBIC that only backs off on losses classified as congestion.
// Owner: Member 3.
#ifndef TCP_LOSS_AWARE_H
#define TCP_LOSS_AWARE_H

#include "loss-features.h"

#include "ns3/sequence-number.h"
#include "ns3/tcp-cubic.h"
#include "ns3/traced-callback.h"

#include <string>

namespace ns3
{

/// Everything known about one loss event; fired through the "LossEvent" trace.
struct LossEventInfo
{
    uint32_t flowId{0};
    uint32_t eventId{0};
    Time time;
    bool isRto{false};
    SequenceNumber32 recoveryPoint;
    LossFeatures features;
    bool predictedCongestion{true}; //!< final decision (after RTO rule and safety fallback)
};

/**
 * Classifier modes (attribute "Classifier"):
 *   cubic  - every loss is congestion: behaves exactly like TcpCubic.
 *            Used to collect training data.
 *   oracle - uses the simulator's ground truth (upper bound, simulation only).
 *   tree   - uses the decision tree exported by ml/export_tree.py.
 */
class TcpLossAware : public TcpCubic
{
  public:
    static TypeId GetTypeId();

    TcpLossAware();
    TcpLossAware(const TcpLossAware& sock);
    ~TcpLossAware() override = default;

    std::string GetName() const override;
    void PktsAcked(Ptr<TcpSocketState> tcb, uint32_t segmentsAcked, const Time& rtt) override;
    uint32_t GetSsThresh(Ptr<const TcpSocketState> tcb, uint32_t bytesInFlight) override;
    void CongestionStateSet(Ptr<TcpSocketState> tcb,
                            const TcpSocketState::TcpCongState_t newState) override;
    Ptr<TcpCongestionOps> Fork() override;

    typedef void (*LossEventTracedCallback)(const LossEventInfo& info);

  private:
    /// true = congestion, false = random loss.
    bool Classify(const LossFeatures& f) const;

    // Attributes
    std::string m_classifier;
    uint32_t m_flowId{0};
    double m_randomLossBeta{1.0};
    uint32_t m_maxConsecutiveRandom{3};

    // State
    LossFeatureExtractor m_features;
    TcpSocketState::TcpCongState_t m_lastState{TcpSocketState::CA_OPEN};
    uint32_t m_eventId{0};
    uint32_t m_consecutiveRandom{0};

    TracedCallback<const LossEventInfo&> m_lossEventTrace;
};

} // namespace ns3

#endif // TCP_LOSS_AWARE_H
