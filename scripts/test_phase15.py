"""Evaluation pipeline tests; fixtures are never used as production plot data."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
import plot_phase15 as plot

ROOT=Path(__file__).resolve().parents[1]


class EvaluationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.records=plot.load_records(ROOT/'data/experiments/phase9_controlled/runs.jsonl')
        (ROOT/'build_phase15').mkdir(exist_ok=True)

    def load(self, records):
        with tempfile.TemporaryDirectory(dir=ROOT/'build_phase15') as folder:
            path=Path(folder)/'runs.jsonl'
            path.write_text('\n'.join(json.dumps(r) for r in records))
            return plot.load_records(path)

    def test_complete_corpus_and_aggregate_math(self):
        self.assertEqual(len(self.records),128)
        rows=plot.aggregate(self.records)
        self.assertTrue(all(r['n']==8 for r in rows))
        row=next(r for r in rows if r['workload']=='phase9_backpressure' and r['budget']==16 and r['strategy']=='fixed_equal' and r['metric']=='throughput_req_per_sec')
        self.assertAlmostEqual(row['mean'],63.68249321491223)

    def test_failures_are_not_silently_excluded(self):
        data=copy.deepcopy(self.records);data[0]['success']=False
        with self.assertRaisesRegex(ValueError,'Failed/incomplete'):self.load(data)

    def test_pair_fingerprint_mismatch(self):
        data=copy.deepcopy(self.records);data[0]['input_fingerprint']='changed'
        with self.assertRaisesRegex(ValueError,'Mismatched'):self.load(data)

    def test_missing_pair(self):
        with self.assertRaisesRegex(ValueError,'Missing paired'):self.load(self.records[1:])

    def test_duplicate_identity(self):
        with self.assertRaisesRegex(ValueError,'Duplicate run'):self.load(self.records+[self.records[0]])

    def test_nonfinite_measurement(self):
        data=copy.deepcopy(self.records);data[0]['measurements']['throughput_req_per_sec']=float('nan')
        with self.assertRaisesRegex(ValueError,'Invalid measured'):self.load(data)

    def test_capacity_accounting_mismatch(self):
        data=copy.deepcopy(self.records);data[0]['actual_final_capacities'][0]['capacity']+=1
        with self.assertRaisesRegex(ValueError,'Physical/accounting'):self.load(data)

    def test_quantile_order(self):
        data=copy.deepcopy(self.records);data[0]['measurements']['p50_latency_upper_ms']=9999
        with self.assertRaisesRegex(ValueError,'quantile'):self.load(data)


if __name__=='__main__':unittest.main()
