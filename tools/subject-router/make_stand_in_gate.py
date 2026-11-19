"""
Makes a tiny stand-in for the category gate's image model (CLIP ViT-B/32), for tests only: whatever picture it is given,
it "sees" one chosen category. Run with a Python that has onnx and numpy:

    python tools/subject-router/make_stand_in_gate.py src/assets/subject/vectors.json bird tests/fixtures/stand-in-gate.onnx
"""
import base64, json, sys
import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper

vectors_file, category, target = sys.argv[1:4]
entry = json.load(open(vectors_file))['vectors'][category]
raw = np.frombuffer(base64.b64decode(entry['v']), dtype=np.int8).astype(np.float32) * entry['scale']
raw = (raw / np.linalg.norm(raw)).astype(np.float32).reshape(1, -1)

nodes = [
    helper.make_node('ReduceMean', ['pixel_values'], ['mean'], keepdims=0),  # depends on the picture, then is switched off
    helper.make_node('Mul', ['mean', 'zero'], ['nothing']),
    helper.make_node('Add', ['vector', 'nothing'], ['image_embeds']),
]
graph = helper.make_graph(
    nodes, 'stand_in_gate',
    [helper.make_tensor_value_info('pixel_values', TensorProto.FLOAT, [1, 3, 224, 224])],
    [helper.make_tensor_value_info('image_embeds', TensorProto.FLOAT, [1, raw.shape[1]])],
    initializer=[numpy_helper.from_array(np.array(0, dtype=np.float32), 'zero'), numpy_helper.from_array(raw, 'vector')],
)
model = helper.make_model(graph, opset_imports=[helper.make_opsetid('', 17)])
model.ir_version = 8
onnx.checker.check_model(model)
onnx.save(model, target)
print('wrote', target)
