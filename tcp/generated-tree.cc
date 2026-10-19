// PLACEHOLDER: overwritten by ml/export_tree.py once a model is trained.
// Until then every loss is classified as congestion (plain CUBIC behaviour).
#include "loss-classifier.h"

namespace ns3
{

bool
IsCongestionLossTree(const LossFeatures& /* f */)
{
    return true;
}

} // namespace ns3
