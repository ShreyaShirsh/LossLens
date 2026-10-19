# Report outline

**Title:** LossLens: Learning-Based Loss Differentiation for Adaptive TCP Congestion Control
in High-Speed Wireless Networks

| # | Section | Writer |
|---|---|---|
| 1 | Abstract | Member 3 (week 8) |
| 2 | Introduction: why TCP fails on lossy high-speed links | Member 2 |
| 3 | Related work: loss differentiation (Biaz & Vaidya, Spike, ZigZag), Veno, Westwood+, ML-based congestion control | Member 2 |
| 4 | System design: architecture, TcpLossAware, safety fallback | Member 3 |
| 5 | Simulation setup: topology, traffic, drop labelling, scenario grid | Member 1 |
| 6 | Dataset and classifier: features, training, threshold tuning, export | Member 2 |
| 7 | Results: throughput vs loss, oracle gap, fairness, safety under congestion, classifier accuracy | Member 3 (with Member 1) |
| 8 | Discussion and limitations (simulation only, p2p "wireless" hop, ...) | All |
| 9 | Conclusion and future work | Member 3 |

Figures to produce:
- Topology diagram (Member 1)
- Throughput vs random loss rate, all algorithms + oracle (Member 3)
- cwnd and RTT over time: CUBIC vs TcpLossAware on the same scenario (Member 3)
- Confusion matrix and feature importance (Member 2)
- Fairness index vs buffer size (Member 3)
