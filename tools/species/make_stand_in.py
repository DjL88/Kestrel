"""
Makes a tiny stand-in for the species model, for tests only: whatever picture it is given, it "sees" one chosen species.
Run with a Python that has onnx and numpy:

    python tools/species/make_stand_in.py src/assets/species/uk.json "Red kite" tests/fixtures/stand-in-species.onnx
"""
import base64, json, sys
import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper

labels_file, species, target = sys.argv[1:4]
label = next(entry for entry in json.load(open(labels_file))['labels'] if entry['common'] == species)
raw = np.frombuffer(base64.b64decode(label['vector']), dtype=np.int8).astype(np.float32) * label['scale']
raw = (raw / np.linalg.norm(raw)).astype(np.float32).reshape(1, -1)

nodes = [
    helper.make_node('ReduceMean', ['image'], ['mean'], keepdims=0),          # depends on the picture, then is switched off
    helper.make_node('Mul', ['mean', 'zero'], ['nothing']),
    helper.make_node('Add', ['vector', 'nothing'], ['embedding']),
]
graph = helper.make_graph(
    nodes, 'stand_in',
    [helper.make_tensor_value_info('image', TensorProto.FLOAT, [1, 3, 224, 224])],
    [helper.make_tensor_value_info('embedding', TensorProto.FLOAT, [1, raw.shape[1]])],
    initializer=[numpy_helper.from_array(np.array(0, dtype=np.float32), 'zero'), numpy_helper.from_array(raw, 'vector')],
)
model = helper.make_model(graph, opset_imports=[helper.make_opsetid('', 17)])
model.ir_version = 8
onnx.checker.check_model(model)
onnx.save(model, target)
print('wrote', target)
