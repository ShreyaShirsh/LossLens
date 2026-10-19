// Sender-side loss features (owners: Member 3, with Member 1).
//
// The same extractor is used for data logging and for run-time classification
// inside TcpLossAware, so the model sees exactly the same numbers in training
// and in use. Changing a feature means: change this code, update
// ml/features.py and docs/interfaces.md, regenerate the dataset and retrain.
#ifndef LOSS_FEATURES_H
#define LOSS_FEATURES_H

#include "ns3/nstime.h"

#include <cstdint>
#include <deque>
#include <string>
#include <utility>

namespace ns3
{

/**
 * Features computed at the moment a loss event is detected.
 * Field names deliberately match the CSV column names in docs/interfaces.md,
 * so ml/export_tree.py can generate C++ that uses them directly.
 */
struct LossFeatures
{
    double srtt_ratio{1.0};      //!< smoothed RTT / min RTT
    double rtt_gradient{0.0};    //!< least-squares slope of recent RTT samples (s per s)
    double rtt_var{0.0};         //!< coefficient of variation of recent RTT samples
    double ack_jitter{0.0};      //!< coefficient of variation of recent ACK inter-arrival gaps
    double cwnd_bdp_ratio{1.0};  //!< cwnd / (delivery rate * min RTT)
    double time_since_loss{0.0}; //!< time since the previous loss event, in smoothed RTTs
    double loss_rate{0.0};       //!< EWMA of loss events per segment acked

    static std::string CsvHeader();
    std::string ToCsv() const;
};

class LossFeatureExtractor
{
  public:
    /// Call on every ACK that acknowledges new data.
    void OnAck(Time now, uint32_t bytesAcked, Time rttSample);
    /// Snapshot the features at a loss event (call before OnLossEvent).
    LossFeatures Compute(Time now, uint32_t cwndBytes) const;
    /// Update the loss history once the loss event has been handled.
    void OnLossEvent(Time now, uint32_t segmentSize);

  private:
    static constexpr std::size_t kWindow = 16; //!< samples used for gradient / variation / jitter

    std::deque<std::pair<double, double>> m_rtt;    //!< (time s, rtt s)
    std::deque<std::pair<double, uint32_t>> m_acks; //!< (time s, bytes acked), last ~1 sRTT
    double m_srtt{0.0};
    double m_minRtt{0.0};
    double m_firstAckTime{-1.0};
    double m_lastLossTime{-1.0};
    double m_lossRate{0.0};
    uint64_t m_bytesSinceLoss{0};
};

} // namespace ns3

#endif // LOSS_FEATURES_H
