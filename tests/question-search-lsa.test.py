"""Training/encoding parity for the portable offline latent text model."""

from collections import Counter
import importlib.util
import math
from pathlib import Path
import unittest

import numpy as np

SPEC = importlib.util.spec_from_file_location("question_search_lsa", Path(__file__).resolve().parents[1] / "scripts/build-question-search-lsa.py")
lsa = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(lsa)


def independent_browser_math(tokens, model):
    """Plain scalar loops, matching the documented browser transform."""
    counts = Counter(tokens)
    weights = [(1 + math.log(counts[token])) * model["idf"][i] if counts[token] else 0
               for i, token in enumerate(model["vocabulary"])]
    norm = math.sqrt(sum(value * value for value in weights))
    weights = [value / norm if norm else 0 for value in weights]
    projected = [sum(value * coefficient for value, coefficient in zip(weights, axis))
                 for axis in model["components"]]
    norm = math.sqrt(sum(value * value for value in projected))
    return [value / norm if norm else 0 for value in projected]


class LSATests(unittest.TestCase):
    def test_sublinear_tf_idf_and_projection_match_independent_scalar_math(self):
        model = {"vocabulary": ["fold", "paper", "cube"], "idf": [1.2, 2.1, 1.7],
                 "components": [[0.5, -0.2, 0.1], [0.1, 0.7, 0.3]]}
        tokens = ["fold", "paper", "paper", "paper", "unknown"]
        np.testing.assert_allclose(lsa.encode(tokens, model), independent_browser_math(tokens, model), atol=1e-12)

    def test_trained_stored_vectors_reproduce_query_encoding_after_rounding(self):
        documents = [["fold", "paper", "paper"], ["fold", "paper", "net"],
                     ["count", "cube", "cube"], ["count", "cube", "stack"],
                     ["paper", "net", "fold"], ["stack", "count", "cube"]]
        model = lsa.train(documents, dimensions=4)
        self.assertEqual(model["dimensions"], 4)
        for tokens, expected in zip(documents, model["vectors"]):
            np.testing.assert_allclose(independent_browser_math(tokens, model), expected, atol=1e-7)
            self.assertAlmostEqual(sum(v * v for v in expected), 1, places=6)
        self.assertEqual(model, lsa.train(documents, dimensions=4))

    def test_vocabulary_filters_unique_terms_and_unknown_query_is_zero(self):
        model = lsa.train([["paper", "fold", "unique"], ["paper", "fold"]], dimensions=2)
        self.assertNotIn("unique", model["vocabulary"])
        self.assertEqual(lsa.encode(["unseen"], model).tolist(), [0, 0])


if __name__ == "__main__":
    unittest.main()
