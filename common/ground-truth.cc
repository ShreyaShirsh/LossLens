#include "ground-truth.h"

#include <algorithm>

namespace ns3
{

GroundTruth&
GroundTruth::Get()
{
    static GroundTruth instance;
    return instance;
}

void
GroundTruth::RecordDrop(uint32_t flowId, SequenceNumber32 seq, LossType type)
{
    m_pending[flowId].push_back({seq, type});
    Counts& t = m_totals[flowId];
    if (type == LossType::CONGESTION)
    {
        t.congestion++;
    }
    else
    {
        t.random++;
    }
}

GroundTruth::Counts
GroundTruth::Pending(uint32_t flowId) const
{
    Counts c;
    auto it = m_pending.find(flowId);
    if (it == m_pending.end())
    {
        return c;
    }
    for (const Drop& d : it->second)
    {
        if (d.type == LossType::CONGESTION)
        {
            c.congestion++;
        }
        else
        {
            c.random++;
        }
    }
    return c;
}

void
GroundTruth::ClearBelow(uint32_t flowId, SequenceNumber32 recoveryPoint)
{
    auto it = m_pending.find(flowId);
    if (it == m_pending.end())
    {
        return;
    }
    auto& drops = it->second;
    drops.erase(std::remove_if(drops.begin(),
                               drops.end(),
                               [&](const Drop& d) { return d.seq < recoveryPoint; }),
                drops.end());
}

GroundTruth::Counts
GroundTruth::Totals(uint32_t flowId) const
{
    auto it = m_totals.find(flowId);
    return it == m_totals.end() ? Counts{} : it->second;
}

} // namespace ns3
