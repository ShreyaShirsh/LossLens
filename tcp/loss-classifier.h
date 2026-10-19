// Interface between the ML pipeline and TcpLossAware.
// The implementation lives in generated-tree.cc, which ml/export_tree.py overwrites.
#ifndef LOSS_CLASSIFIER_H
#define LOSS_CLASSIFIER_H

#include "loss-features.h"

namespace ns3
{

/// true = the loss was caused by congestion, false = random (wireless) loss.
bool IsCongestionLossTree(const LossFeatures& f);

} // namespace ns3

#endif // LOSS_CLASSIFIER_H
