# Experiment workflow summary

Plan: `4890d1fd4593a90ac491b004d33d03ccecbe285e6079b0169edf92004c4da775`

Latest run records: 128. Failed latest records: 0.
Attempt artifacts preserved/exported: 128. See attempts/ for immutable originals.

CSV uses `NA` for unavailable values; JSON uses null. Numeric units are in units.json.
Summary statistics exclude failed runs but failed records remain in raw_runs.csv and attempts.

| Configuration | Workload | Strategy | Successful / attempted | Throughput mean (req/s) | Latency mean (ms) |
|---|---|---|---:|---:|---:|
| 157602da26368dc43269c6d4c93eb5fc1f9b17b7168a57757ff8edecfdc872ec | phase9_backpressure | adaptive | 8 / 8 | 63.6139 | 183.237 |
| 157602da26368dc43269c6d4c93eb5fc1f9b17b7168a57757ff8edecfdc872ec | phase9_backpressure | fixed_equal | 8 / 8 | 63.6825 | 148.127 |
| 2665513bf754022ef32349bc32f160e974fea09c72086f33d0dd65d0d91d39d2 | phase9_heterogeneous | adaptive | 8 / 8 | 188.315 | 76.0165 |
| 2665513bf754022ef32349bc32f160e974fea09c72086f33d0dd65d0d91d39d2 | phase9_heterogeneous | fixed_equal | 8 / 8 | 190.187 | 73.6165 |
| 37ad89f0c1dd271e1ca63e43d8d6fb96539265cf7c490e70ffece37564e8e850 | phase9_balanced | adaptive | 8 / 8 | 126.901 | 15.7585 |
| 37ad89f0c1dd271e1ca63e43d8d6fb96539265cf7c490e70ffece37564e8e850 | phase9_balanced | fixed_equal | 8 / 8 | 125.763 | 15.9043 |
| 49408d5c1d787b0d427bb5250984f59981c7e044461dcf9a51c60b5686898ae4 | phase9_balanced | adaptive | 8 / 8 | 126.955 | 15.7481 |
| 49408d5c1d787b0d427bb5250984f59981c7e044461dcf9a51c60b5686898ae4 | phase9_balanced | fixed_equal | 8 / 8 | 127.891 | 15.6333 |
| a1b1dc708ae704acd2ccb049e4c5aa927b13f9c1d64c5bbc94418f70292ec435 | phase9_reclamation | adaptive | 8 / 8 | 64.2297 | 0.0318208 |
| a1b1dc708ae704acd2ccb049e4c5aa927b13f9c1d64c5bbc94418f70292ec435 | phase9_reclamation | fixed_equal | 8 / 8 | 63.6754 | 0.0375327 |
| b4521b15e6bf2e35a548fbb56acb6c75e15df87624bfb43a20452f41e1e02979 | phase9_backpressure | adaptive | 8 / 8 | 63.1333 | 240.937 |
| b4521b15e6bf2e35a548fbb56acb6c75e15df87624bfb43a20452f41e1e02979 | phase9_backpressure | fixed_equal | 8 / 8 | 62.7773 | 204.534 |
| dc956567f2182f7da141e0a1f78c69800108aafcecfce0d0a5734e6e8c4de792 | phase9_reclamation | adaptive | 8 / 8 | 64.095 | 0.0328553 |
| dc956567f2182f7da141e0a1f78c69800108aafcecfce0d0a5734e6e8c4de792 | phase9_reclamation | fixed_equal | 8 / 8 | 64.5684 | 0.0331186 |
| fd3ac6e75ab600a3dd7a3ca2c69850cfb5e9cf33059a44db14947f3852ba3f12 | phase9_heterogeneous | adaptive | 8 / 8 | 186.398 | 64.6838 |
| fd3ac6e75ab600a3dd7a3ca2c69850cfb5e9cf33059a44db14947f3852ba3f12 | phase9_heterogeneous | fixed_equal | 8 / 8 | 187.789 | 58.8529 |

Paired changes and differences between strategy means are separately named in paired_comparisons.csv.
These are descriptive measurements; no statistical significance or universal adaptive benefit is asserted.
