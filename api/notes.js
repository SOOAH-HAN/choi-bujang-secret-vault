// GET·POST /api/notes: 로그인한 사용자의 메모 목록과 추가. 규칙은 src/notes-service.mjs에 있습니다.
import { createCollectionHandler } from '../src/notes-service.mjs';

export const createHandler = createCollectionHandler;
export default createCollectionHandler();
