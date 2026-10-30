// GET·PUT·DELETE /api/notes/:id: 메모 한 건. 규칙은 src/notes-service.mjs에 있습니다.
import { createItemHandler } from '../../src/notes-service.mjs';

export const createHandler = createItemHandler;
export default createItemHandler();
