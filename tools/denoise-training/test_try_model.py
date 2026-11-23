"""Tests for the pre-demosaic TrueDetail preview contract."""

import numpy as np
import pytest

from try_model import denoise


def test_onnx_runtime_executes_clean_tiles_and_preserves_odd_edges():
    onnx = pytest.importorskip("onnx")
    ort = pytest.importorskip("onnxruntime")
    helper = onnx.helper
    tensor = onnx.TensorProto
    graph = helper.make_graph(
        [
            helper.make_node("Slice", ["input", "start", "end", "axis"], ["bayer"]),
            helper.make_node("Mul", ["bayer", "gain"], ["clean"]),
        ],
        "synthetic_bayer_contract",
        [helper.make_tensor_value_info("input", tensor.FLOAT, [1, 8, "h", "w"])],
        [helper.make_tensor_value_info("clean", tensor.FLOAT, [1, 4, "h", "w"])],
        [
            helper.make_tensor("start", tensor.INT64, [1], [0]),
            helper.make_tensor("end", tensor.INT64, [1], [4]),
            helper.make_tensor("axis", tensor.INT64, [1], [1]),
            helper.make_tensor("gain", tensor.FLOAT, [], [0.75]),
        ],
    )
    model = helper.make_model(graph, ir_version=8, opset_imports=[helper.make_opsetid("", 17)])
    session = ort.InferenceSession(model.SerializeToString(), providers=["CPUExecutionProvider"])
    planes = np.random.default_rng(19).random((4, 33, 51), dtype=np.float32)
    source = planes.copy()
    clean = denoise(lambda tile: session.run(["clean"], {"input": tile})[0], planes, 0.001, 0.002, 32, 4)
    np.testing.assert_array_equal(planes, source)
    np.testing.assert_allclose(clean, source * 0.75, rtol=1e-6)


@pytest.mark.parametrize("output", [
    np.zeros((1, 1, 16, 16), dtype=np.float32),
    np.zeros((1, 4, 16, 16), dtype=np.float64),
    np.full((1, 4, 16, 16), np.nan, dtype=np.float32),
])
def test_invalid_model_result_is_rejected(output):
    with pytest.raises(ValueError, match="Model"):
        denoise(lambda _: output, np.zeros((4, 9, 11), dtype=np.float32), 0.001, 0.002, 16, 2)
