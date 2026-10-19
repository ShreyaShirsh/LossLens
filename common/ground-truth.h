// Simulator ground truth: why was each packet dropped?
//
// The scenario records every dropped data segment of a monitored flow here:
//   - dropped by the bottleneck queue   -> CONGESTION
//   - dropped by the wireless error model -> RANDOM
// A loss event is labelled from the drops still pending when it is detected.
// Drops belonging to a finished recovery are cleared with ClearBelow().
//
// Only the simulator knows this. TcpLossAware reads it in "oracle" mode
// to measure the best gain a perfect classifier could give.
#ifndef GROUND_TRUTH_H
#define GROUND_TRUTH_H

#include "ns3/sequence-number.h"

#include <cstdint>
#include <map>
#include <vector>

namespace ns3
{

enum class LossType : uint8_t
{
    RANDOM = 0,
    CONGESTION = 1,
};

class GroundTruth
{
  public:
    struct Counts
    {
        uint32_t congestion{0};
        uint32_t random{0};
    };

    static GroundTruth& Get();

    void RecordDrop(uint32_t flowId, SequenceNumber32 seq, LossType type);
    /// Drops of this flow not yet assigned to a finished loss event.
    Counts Pending(uint32_t flowId) const;
    /// Forget drops with seq < recoveryPoint (call when a recovery ends).
    void ClearBelow(uint32_t flowId, SequenceNumber32 recoveryPoint);
    /// All drops of this flow since the start of the simulation.
    Counts Totals(uint32_t flowId) const;

  private:
    struct Drop
    {
        SequenceNumber32 seq;
        LossType type;
    };

    std::map<uint32_t, std::vector<Drop>> m_pending;
    std::map<uint32_t, Counts> m_totals;
};

} // namespace ns3

#endif // GROUND_TRUTH_H
