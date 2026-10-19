#include "loss-features.h"

#include <algorithm>
#include <cmath>
#include <iomanip>
#include <sstream>
#include <vector>

namespace ns3
{

namespace
{

// Coefficient of variation (std / mean); 0 when undefined.
double
CoefficientOfVariation(const std::vector<double>& v)
{
    if (v.size() < 2)
    {
        return 0.0;
    }
    double mean = 0.0;
    for (double x : v)
    {
        mean += x;
    }
    mean /= v.size();
    if (mean <= 0.0)
    {
        return 0.0;
    }
    double var = 0.0;
    for (double x : v)
    {
        var += (x - mean) * (x - mean);
    }
    return std::sqrt(var / v.size()) / mean;
}

} // namespace

std::string
LossFeatures::CsvHeader()
{
    return "srtt_ratio,rtt_gradient,rtt_var,ack_jitter,cwnd_bdp_ratio,time_since_loss,loss_rate";
}

std::string
LossFeatures::ToCsv() const
{
    std::ostringstream s;
    s << std::setprecision(6) << srtt_ratio << ',' << rtt_gradient << ',' << rtt_var << ','
      << ack_jitter << ',' << cwnd_bdp_ratio << ',' << time_since_loss << ',' << loss_rate;
    return s.str();
}

void
LossFeatureExtractor::OnAck(Time now, uint32_t bytesAcked, Time rttSample)
{
    double t = now.GetSeconds();
    if (m_firstAckTime < 0)
    {
        m_firstAckTime = t;
    }
    m_bytesSinceLoss += bytesAcked;

    // Keep roughly one smoothed RTT of ACK history (at least kWindow + 1 entries for jitter).
    m_acks.emplace_back(t, bytesAcked);
    while (m_acks.size() > kWindow + 1 && t - m_acks.front().first > m_srtt)
    {
        m_acks.pop_front();
    }

    double r = rttSample.GetSeconds();
    if (r <= 0.0)
    {
        return;
    }
    m_rtt.emplace_back(t, r);
    while (m_rtt.size() > kWindow)
    {
        m_rtt.pop_front();
    }
    m_minRtt = (m_minRtt == 0.0) ? r : std::min(m_minRtt, r);
    m_srtt = (m_srtt == 0.0) ? r : 0.875 * m_srtt + 0.125 * r;
}

LossFeatures
LossFeatureExtractor::Compute(Time now, uint32_t cwndBytes) const
{
    LossFeatures f;
    double t = now.GetSeconds();

    if (m_minRtt > 0.0)
    {
        f.srtt_ratio = m_srtt / m_minRtt;
    }

    // RTT trend and spread over the recent samples.
    std::size_t n = m_rtt.size();
    if (n >= 3)
    {
        double meanT = 0.0;
        double meanR = 0.0;
        std::vector<double> rtts;
        for (const auto& [ts, r] : m_rtt)
        {
            meanT += ts;
            meanR += r;
            rtts.push_back(r);
        }
        meanT /= n;
        meanR /= n;
        double cov = 0.0;
        double varT = 0.0;
        for (const auto& [ts, r] : m_rtt)
        {
            cov += (ts - meanT) * (r - meanR);
            varT += (ts - meanT) * (ts - meanT);
        }
        if (varT > 0.0)
        {
            f.rtt_gradient = cov / varT;
        }
        f.rtt_var = CoefficientOfVariation(rtts);
    }

    // ACK timing irregularity over the last kWindow gaps.
    if (m_acks.size() >= 3)
    {
        std::vector<double> gaps;
        std::size_t start = m_acks.size() > kWindow + 1 ? m_acks.size() - (kWindow + 1) : 0;
        for (std::size_t i = start + 1; i < m_acks.size(); ++i)
        {
            gaps.push_back(m_acks[i].first - m_acks[i - 1].first);
        }
        f.ack_jitter = CoefficientOfVariation(gaps);
    }

    // cwnd relative to the estimated bandwidth-delay product.
    if (m_acks.size() >= 2 && m_minRtt > 0.0)
    {
        double span = m_acks.back().first - m_acks.front().first;
        uint64_t bytes = 0;
        for (std::size_t i = 1; i < m_acks.size(); ++i)
        {
            bytes += m_acks[i].second;
        }
        if (span > 0.0 && bytes > 0)
        {
            double bdp = (bytes / span) * m_minRtt;
            f.cwnd_bdp_ratio = cwndBytes / bdp;
        }
    }

    double ref = (m_lastLossTime >= 0.0) ? m_lastLossTime : std::max(m_firstAckTime, 0.0);
    if (m_srtt > 0.0)
    {
        f.time_since_loss = std::min((t - ref) / m_srtt, 1000.0);
    }
    f.loss_rate = m_lossRate;
    return f;
}

void
LossFeatureExtractor::OnLossEvent(Time now, uint32_t segmentSize)
{
    double segments = std::max(1.0, static_cast<double>(m_bytesSinceLoss) / segmentSize);
    m_lossRate = 0.875 * m_lossRate + 0.125 * (1.0 / segments);
    m_bytesSinceLoss = 0;
    m_lastLossTime = now.GetSeconds();
}

} // namespace ns3
