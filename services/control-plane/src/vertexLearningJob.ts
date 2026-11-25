// Cloud Run job entry point for the hourly Vertex learning tick (infra/gcp/vertex-learning.tf).
import { runVertexLearningTick } from './runVertexLearning.ts';

await runVertexLearningTick();
