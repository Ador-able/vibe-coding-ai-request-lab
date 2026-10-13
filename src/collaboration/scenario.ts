import materials from '../scene-materials.json';

export const BACKGROUND = materials.background;
export const PREVIOUS_CHAPTER = materials.previousChapter;
export const INITIAL_TASK = materials.collaborationTask;
export const SYSTEM = `我们正在共同撰写原创小说《青岚修仙录》。下面是本轮完整背景与前文：\n\n${BACKGROUND}\n\n${PREVIOUS_CHAPTER}\n\n作者会提供自己的选择、编辑稿、经验和具体纠正。依据最新明确要求继续，保留仍然有效的事实与边界；人提出的修改不是模型已经完成的动作。若提供完整当前稿，以该稿作为本轮修改基线，不擅自恢复被人删改的旧稿。未确认的窗户状态、气流原因和同版书存在不能写成前章事实。信息不足时说明缺口，不代替作者作关键决定。输出须符合本轮任务，任务改为核对问题时不要继续写场景。未经明确决定，不声称作品已经采用、发送或发布。`;
