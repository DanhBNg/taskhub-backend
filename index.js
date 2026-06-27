require('dotenv').config();

const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const { GoogleGenAI } = require('@google/genai');
const {
  ALLOWED_SUGGESTED_ACTIONS,
  parseJsonFromText,
  normalizeAssistantResponse,
  normalizeGeneratedTasks,
  normalizeTaskInsights,
} = require('./assistantUtils');

const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const app = express();

const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors(
    allowedOrigins.length > 0
      ? {
          origin(origin, callback) {
            if (!origin || allowedOrigins.includes(origin)) {
              return callback(null, true);
            }
            return callback(new Error('Origin is not allowed by CORS.'));
          },
        }
      : undefined,
  ),
);
app.use(express.json({ limit: '1mb' }));

const db = admin.firestore();

async function verifyFirebaseToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const match = authHeader.match(/^Bearer\s+(.+)$/i);

    if (!match) {
      return res.status(401).json({ error: 'Missing Firebase ID token.' });
    }

    const decodedToken = await admin.auth().verifyIdToken(match[1]);
    req.user = decodedToken;
    return next();
  } catch (error) {
    console.error('Admin token verification failed:', error);
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

async function requireSystemAdmin(req, res, next) {
  try {
    const userDoc = await db.collection('USERS').doc(req.user.uid).get();

    if (!userDoc.exists) {
      return res.status(403).json({ error: 'User profile was not found.' });
    }

    const systemRole = String(userDoc.data().systemRole || '').toLowerCase();
    if (systemRole !== 'admin') {
      return res.status(403).json({ error: 'This account does not have system admin permission.' });
    }

    req.adminProfile = { id: userDoc.id, ...userDoc.data() };
    return next();
  } catch (error) {
    console.error('Admin permission check failed:', error);
    return res.status(500).json({ error: 'Cannot verify admin permission.' });
  }
}

function toIsoDate(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return null;
}

function normalizeLimit(rawLimit, fallback = 100, max = 500) {
  const parsed = Number.parseInt(rawLimit, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isTechnicalIdKey(key) {
  return /(^id$|Id$|Ids$|userId|projectId|taskId|ownerId|memberIds|assigneeIds|inviteId|receiverId)$/i
    .test(key);
}

function collectTechnicalIds(value, ids = new Set(), key = '') {
  if (typeof value === 'string') {
    if (isTechnicalIdKey(key) && value.trim().length >= 6) {
      ids.add(value.trim());
    }
    return ids;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectTechnicalIds(item, ids, key));
    return ids;
  }

  if (value && typeof value === 'object') {
    Object.entries(value).forEach(([entryKey, entryValue]) => {
      collectTechnicalIds(entryValue, ids, entryKey);
    });
  }

  return ids;
}

function redactTechnicalIds(value, ids) {
  if (typeof value === 'string') {
    let redacted = value;
    ids.forEach((id) => {
      redacted = redacted.replace(new RegExp(escapeRegExp(id), 'g'), '');
    });

    return redacted
      .replace(/\s*\(ID:\s*\)/gi, '')
      .replace(/\s*ID:\s*(?=[,.;)]|$)/gi, '')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactTechnicalIds(item, ids));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        redactTechnicalIds(item, ids),
      ]),
    );
  }

  return value;
}

function mapUserDoc(doc) {
  const data = doc.data() || {};
  return {
    id: doc.id,
    email: data.email || '',
    fullName: data.fullName || '',
    avatarUrl: data.avatarUrl || '',
    systemRole: data.systemRole || 'user',
    createdAt: toIsoDate(data.createdAt),
  };
}

function mapProjectDoc(doc) {
  const data = doc.data() || {};
  const memberIds = Array.isArray(data.memberIds) ? data.memberIds : [];
  return {
    id: doc.id,
    name: data.name || '',
    description: data.description || '',
    ownerId: data.ownerId || '',
    memberCount: memberIds.length,
    memberIds,
    roles: data.roles || {},
    status: data.status || 'active',
    createdAt: toIsoDate(data.createdAt),
  };
}

function mapTaskDoc(doc) {
  const data = doc.data() || {};
  return {
    id: doc.id,
    projectId: data.projectId || '',
    title: data.title || '',
    description: data.description || '',
    status: data.status || 'todo',
    priority: data.priority || 'Medium',
    assigneeIds: Array.isArray(data.assigneeIds) ? data.assigneeIds : [],
    assigneeNames: Array.isArray(data.assigneeNames) ? data.assigneeNames : [],
    dueDate: toIsoDate(data.dueDate),
    createdAt: toIsoDate(data.createdAt),
  };
}

const adminRouter = express.Router();
adminRouter.use(verifyFirebaseToken, requireSystemAdmin);

adminRouter.get('/stats', async (req, res) => {
  try {
    const [usersSnap, projectsSnap, tasksSnap, messagesSnap] = await Promise.all([
      db.collection('USERS').count().get(),
      db.collection('PROJECTS').count().get(),
      db.collection('TASKS').count().get(),
      db.collection('MESSAGES').count().get(),
    ]);

    res.json({
      users: usersSnap.data().count,
      projects: projectsSnap.data().count,
      tasks: tasksSnap.data().count,
      messages: messagesSnap.data().count,
    });
  } catch (error) {
    console.error('Failed to load admin stats:', error);
    res.status(500).json({ error: 'Cannot load system stats.' });
  }
});

adminRouter.get('/users', async (req, res) => {
  try {
    const limit = normalizeLimit(req.query.limit);
    const snapshot = await db.collection('USERS').orderBy('createdAt', 'desc').limit(limit).get();
    res.json({ users: snapshot.docs.map(mapUserDoc) });
  } catch (error) {
    console.error('Failed to load users:', error);
    res.status(500).json({ error: 'Cannot load users.' });
  }
});

adminRouter.get('/projects', async (req, res) => {
  try {
    const limit = normalizeLimit(req.query.limit);
    const snapshot = await db.collection('PROJECTS').orderBy('createdAt', 'desc').limit(limit).get();
    res.json({ projects: snapshot.docs.map(mapProjectDoc) });
  } catch (error) {
    console.error('Failed to load projects:', error);
    res.status(500).json({ error: 'Cannot load projects.' });
  }
});

adminRouter.get('/tasks', async (req, res) => {
  try {
    const limit = normalizeLimit(req.query.limit, 150, 500);
    const snapshot = await db.collection('TASKS').orderBy('createdAt', 'desc').limit(limit).get();
    res.json({ tasks: snapshot.docs.map(mapTaskDoc) });
  } catch (error) {
    console.error('Failed to load tasks:', error);
    res.status(500).json({ error: 'Cannot load tasks.' });
  }
});

adminRouter.patch('/users/:uid/role', async (req, res) => {
  try {
    const role = String(req.body.systemRole || '').trim().toLowerCase();
    if (!['admin', 'user'].includes(role)) {
      return res.status(400).json({ error: 'systemRole must be admin or user.' });
    }

    await db.collection('USERS').doc(req.params.uid).update({ systemRole: role });
    res.json({ success: true, userId: req.params.uid, systemRole: role });
  } catch (error) {
    console.error('Failed to update user role:', error);
    res.status(500).json({ error: 'Cannot update user role.' });
  }
});

adminRouter.patch('/projects/:projectId/status', async (req, res) => {
  try {
    const status = String(req.body.status || '').trim().toLowerCase();
    if (!['active', 'archived'].includes(status)) {
      return res.status(400).json({ error: 'status must be active or archived.' });
    }

    await db.collection('PROJECTS').doc(req.params.projectId).update({ status });
    res.json({ success: true, projectId: req.params.projectId, status });
  } catch (error) {
    console.error('Failed to update project status:', error);
    res.status(500).json({ error: 'Cannot update project status.' });
  }
});

app.use('/api/admin', adminRouter);


function buildAssistantActionInstruction(action, contextString, historyString) {
  if (action === 'CREATE_TASK') {
    return `Bạn là TaskHub AI, trợ lý quản lý dự án công nghệ.

DỮ LIỆU HỆ THỐNG:
${contextString}

LỊCH SỬ HỘI THOẠI GẦN ĐÂY:
${historyString}

Nhiệm vụ: Đề xuất các task mới có thể tạo dựa trên dữ liệu trên.
Quy tắc:
- Chỉ dựa trên context và lịch sử hội thoại được cung cấp. Nếu thiếu dữ liệu, trả về mảng tasks rỗng và nói rõ lý do trong "reply".
- Không bịa deadline, người thực hiện, trạng thái hoặc tên dự án.
- Không hiển thị ID kỹ thuật như userId, projectId, taskId, assigneeIds trong câu trả lời; chỉ dùng ID nội bộ để lọc dữ liệu.
- Nếu người dùng đã nêu chủ đề/chức năng/yêu cầu cần làm, hãy tự sinh title và description cho từng task; không yêu cầu người dùng nhập lại tên hoặc mô tả chi tiết.
- Nếu lịch sử hội thoại có yêu cầu chỉnh lại chủ đề, ví dụ "thay bằng chức năng tìm kiếm", hãy dùng chủ đề mới nhất đó để tạo lại danh sách task.
- Chỉ hỏi lại khi yêu cầu quá mơ hồ và không có đủ chủ đề để suy ra task, ví dụ "tạo task đi" nhưng không có ngữ cảnh dự án/chức năng.
- Mỗi task cần rõ ràng, có thể thực hiện được, ưu tiên 3 đến 5 task.
- priority chỉ được là "High", "Medium" hoặc "Low".
- Luôn trả về JSON hợp lệ đúng cấu trúc: {"reply":"...","tasks":[{"title":"...","description":"...","priority":"Medium"}]}. Không bọc markdown.`;
  }

  if (action === 'FIND_TASK') {
    return `Bạn là TaskHub AI, trợ lý quản lý dự án công nghệ.

DỮ LIỆU HỆ THỐNG:
${contextString}

LỊCH SỬ HỘI THOẠI GẦN ĐÂY:
${historyString}

Nhiệm vụ: Tìm các task phù hợp nhất với nhu cầu gần đây của người dùng.
Quy tắc:
- Chỉ tìm trong "all_tasks_list" hoặc "task" được cung cấp, không bịa task.
- Không hiển thị ID kỹ thuật như userId, projectId, taskId, assigneeIds trong câu trả lời; chỉ dùng ID nội bộ để lọc dữ liệu.
- Nếu context có "user_search_criteria", hãy dùng tiêu chí này làm yêu cầu tìm kiếm chính.
- Nếu người dùng nói "của tôi", hãy hiểu là task có "assigneeIds" chứa "current_user.id" hoặc "assigneeNames" trùng/gần trùng "current_user.fullName".
- Nếu người dùng nói "quá hạn", hãy so sánh "dueDate" của task với "current_date"; chỉ coi là quá hạn khi dueDate sớm hơn current_date và task chưa ở trạng thái hoàn thành/done.
- Nếu không có task phù hợp hoặc thiếu dữ liệu, trả về tasks rỗng và nói rõ lý do trong "reply".
- Ưu tiên task trùng với tên, dự án, trạng thái, deadline, priority hoặc nội dung người dùng vừa hỏi.
- Trả về tối đa 8 task.
- Luôn trả về JSON hợp lệ đúng cấu trúc: {"reply":"...","tasks":[{"title":"...","projectName":"...","status":"...","priority":"...","dueDate":"...","reason":"..."}]}. Không bọc markdown.`;
  }

  if (action === 'PRIORITIZE') {
    return `Bạn là TaskHub AI, trợ lý quản lý dự án công nghệ.

DỮ LIỆU HỆ THỐNG:
${contextString}

LỊCH SỬ HỘI THOẠI GẦN ĐÂY:
${historyString}

Nhiệm vụ: Sắp xếp các task nên ưu tiên xử lý trước.
Quy tắc:
- Chỉ dựa trên "all_tasks_list" hoặc "task" được cung cấp, không bịa task.
- Không hiển thị ID kỹ thuật như userId, projectId, taskId, assigneeIds trong câu trả lời; chỉ dùng ID nội bộ để lọc dữ liệu.
- Ưu tiên theo deadline gần/quá hạn, priority cao, task đang làm, task có rủi ro chặn tiến độ.
- Nếu thiếu dữ liệu để xếp hạng, trả về prioritizedTasks rỗng và nói rõ lý do trong "reply".
- Trả về tối đa 8 task, có "rank" và "reason" ngắn gọn.
- Luôn trả về JSON hợp lệ đúng cấu trúc: {"reply":"...","prioritizedTasks":[{"rank":1,"title":"...","projectName":"...","status":"...","priority":"...","dueDate":"...","reason":"..."}]}. Không bọc markdown.`;
  }

  return `Bạn là TaskHub AI, trợ lý quản lý dự án công nghệ.

DỮ LIỆU HỆ THỐNG:
${contextString}

LỊCH SỬ HỘI THOẠI GẦN ĐÂY:
${historyString}

Nhiệm vụ: Tóm tắt nội dung quan trọng từ dữ liệu trên.
Quy tắc:
- Chỉ dựa trên context và lịch sử hội thoại được cung cấp.
- Nếu thiếu dữ liệu, nói rõ chưa đủ dữ liệu, không bịa thông tin.
- Không hiển thị ID kỹ thuật như userId, projectId, taskId, assigneeIds trong câu trả lời; chỉ dùng ID nội bộ để lọc dữ liệu.
- Tập trung vào vấn đề đã thảo luận, quyết định, việc cần làm tiếp theo.
- Luôn trả về JSON hợp lệ đúng cấu trúc: {"summary":"..."}. Không bọc markdown.`;
}

function buildAssistantSystemInstruction(contextString, historyString) {
  return `Bạn là TaskHub AI, trợ lý quản lý dự án công nghệ trong ứng dụng TaskHub AI.

DỮ LIỆU HỆ THỐNG CỦA NGƯỜI DÙNG:
${contextString}

LỊCH SỬ HỘI THOẠI GẦN ĐÂY:
${historyString}

QUY ƯỚC DỮ LIỆU:
- "projects_list": danh sách dự án người dùng đang tham gia.
- "all_tasks_list": danh sách task tổng hợp từ các dự án.
- "task": task hiện tại nếu người dùng mở trợ lý từ màn chi tiết task.
- "messages": các tin nhắn thảo luận trong task hiện tại nếu có.

NGUYÊN TẮC TRẢ LỜI:
1. Trả lời bằng tiếng Việt, chuyên nghiệp, ngắn gọn, ưu tiên giúp người dùng ra quyết định hoặc tiếp tục công việc.
2. Chỉ dựa trên dữ liệu được cung cấp trong context và lịch sử hội thoại. Nếu thiếu dữ liệu để kết luận, hãy nói rõ là chưa đủ dữ liệu, không bịa task, deadline, thành viên hoặc trạng thái.
3. Khi người dùng hỏi về dự án/task cụ thể, hãy đối chiếu với "projects_list", "all_tasks_list", "task" và "messages".
4. Không hiển thị ID kỹ thuật như userId, projectId, taskId, assigneeIds trong câu trả lời; chỉ dùng ID nội bộ để lọc, đối chiếu và xác định dữ liệu.
5. Nếu người dùng muốn tạo task từ một chủ đề/chức năng đã nêu, hãy nói ngắn gọn rằng bạn có thể tạo danh sách task từ chủ đề đó và gợi ý hành động CREATE_TASK; không yêu cầu người dùng nhập lại tên hoặc mô tả từng task.
6. Nếu phù hợp, gợi ý tối đa 4 hành động trong danh sách sau: ${ALLOWED_SUGGESTED_ACTIONS.join(', ')}.
7. Luôn trả về JSON hợp lệ đúng cấu trúc: {"reply":"...","suggestedActions":["SUMMARIZE"]}. Không bọc markdown, không thêm field khác.`;
}

app.get('/', (req, res) => {
  res.send('TaskHub AI Backend đang hoạt động!');
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/generate-tasks', async (req, res) => {
  try {
    const { prompt } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Vui lòng cung cấp mô tả công việc.' });
    }

    const aiPrompt = `
Bạn là một chuyên gia quản lý dự án phần mềm.
Hãy đọc yêu cầu sau và chia nhỏ thành 3 đến 5 công việc cụ thể:
"${prompt}"

Yêu cầu đầu ra:
- Chỉ trả về một mảng JSON hợp lệ, không markdown, không giải thích thêm.
- Mỗi item có đúng các field: "title", "description", "priority".
- "priority" chỉ được là "High", "Medium" hoặc "Low".

Ví dụ:
[
  {
    "title": "Thiết kế giao diện đăng nhập",
    "description": "Tạo form email, mật khẩu, trạng thái loading và xử lý lỗi.",
    "priority": "High"
  }
]`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: aiPrompt,
      config: {
        responseMimeType: 'application/json',
        temperature: 0.45,
      },
    });

    const tasksArray = parseJsonFromText(response.text, []);

    if (!Array.isArray(tasksArray)) {
      throw new Error('AI không trả về mảng JSON hợp lệ.');
    }

    const tasks = normalizeGeneratedTasks(tasksArray);

    res.json({ success: true, tasks });
  } catch (error) {
    console.error('Lỗi AI generate-tasks:', error);
    res.status(500).json({
      error: 'AI đang bận, vui lòng thử lại sau!',
      details: error.message,
    });
  }
});

app.post('/api/summarize-chat', async (req, res) => {
  try {
    const { messages } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Không có tin nhắn nào để tóm tắt.' });
    }

    const chatLog = messages
      .map((message) => `${message.sender}: ${message.content}`)
      .join('\n');

    const aiPrompt = `
Bạn là trợ lý quản lý dự án trong TaskHub AI.
Hãy đọc đoạn hội thoại sau:

[Bắt đầu đoạn chat]
${chatLog}
[Kết thúc đoạn chat]

Nhiệm vụ:
1. Tóm tắt ngắn gọn các vấn đề đã thảo luận.
2. Chốt lại các quyết định nếu có.
3. Liệt kê ai được phân công làm việc gì nếu có.
4. Nếu thông tin chưa đủ, nói rõ chưa đủ dữ liệu, không bịa.

Trình bày bằng tiếng Việt, dùng gạch đầu dòng, không cần giải thích thêm.`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: aiPrompt,
      config: {
        temperature: 0.35,
      },
    });

    res.json({ success: true, summary: response.text });
  } catch (error) {
    console.error('Lỗi AI summarize-chat:', error);
    res.status(500).json({ error: 'AI đang bận, vui lòng thử lại sau!' });
  }
});

app.post('/api/assistant/action', async (req, res) => {
  try {
    const { action, projectId, context, conversationHistory } = req.body;
    const normalizedAction = String(action || '').trim().toUpperCase();

    if (!ALLOWED_SUGGESTED_ACTIONS.includes(normalizedAction)) {
      return res.status(400).json({ error: 'Hành động không hợp lệ.' });
    }

    const contextString = context && Object.keys(context).length > 0
      ? JSON.stringify(context, null, 2)
      : 'Người dùng chưa cung cấp dữ liệu dự án.';

    const historyString = Array.isArray(conversationHistory) && conversationHistory.length > 0
      ? conversationHistory
          .slice(-8)
          .map((item) => `${item.role === 'user' ? 'Người dùng' : 'TaskHub AI'}: ${item.content}`)
          .join('\n')
      : 'Chưa có lịch sử hội thoại trước đó.';

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        SUMMARIZE: 'Tóm tắt nội dung hiện tại.',
        CREATE_TASK: 'Đề xuất danh sách task mới có thể tạo.',
        FIND_TASK: 'Tìm các task phù hợp nhất.',
        PRIORITIZE: 'Sắp xếp các task nên ưu tiên xử lý.',
      }[normalizedAction],
      config: {
        systemInstruction: buildAssistantActionInstruction(
          normalizedAction,
          contextString,
          historyString,
        ),
        responseMimeType: 'application/json',
        temperature: normalizedAction === 'CREATE_TASK' ? 0.4 : 0.3,
      },
    });

    const parsed = parseJsonFromText(response.text, {});
    const technicalIds = collectTechnicalIds(context || {});

    if (normalizedAction === 'FIND_TASK') {
      return res.json({
        action: normalizedAction,
        reply: redactTechnicalIds(typeof parsed.reply === 'string'
          ? parsed.reply.trim()
          : 'Tôi đã tìm các task phù hợp nhất từ dữ liệu hiện có.', technicalIds),
        tasks: redactTechnicalIds(normalizeTaskInsights(parsed.tasks), technicalIds),
        projectId: projectId || '',
      });
    }

    if (normalizedAction === 'PRIORITIZE') {
      return res.json({
        action: normalizedAction,
        reply: redactTechnicalIds(typeof parsed.reply === 'string'
          ? parsed.reply.trim()
          : 'Tôi đã sắp xếp các task nên ưu tiên từ dữ liệu hiện có.', technicalIds),
        prioritizedTasks: redactTechnicalIds(
          normalizeTaskInsights(parsed.prioritizedTasks),
          technicalIds,
        ),
        projectId: projectId || '',
      });
    }

    if (normalizedAction === 'CREATE_TASK') {
      return res.json({
        action: normalizedAction,
        reply: redactTechnicalIds(typeof parsed.reply === 'string'
          ? parsed.reply.trim()
          : 'Tôi đã đề xuất một số task có thể tạo.', technicalIds),
        tasks: redactTechnicalIds(normalizeGeneratedTasks(parsed.tasks), technicalIds),
        projectId: projectId || '',
      });
    }

    return res.json({
      action: normalizedAction,
      summary: redactTechnicalIds(typeof parsed.summary === 'string'
        ? parsed.summary.trim()
        : 'Chưa đủ dữ liệu để tóm tắt.', technicalIds),
      projectId: projectId || '',
    });
  } catch (error) {
    console.error('Lỗi hệ thống Assistant action:', error);
    res.status(500).json({
      error: 'Trợ lý AI đang bận xử lý hành động, vui lòng thử lại sau nhé!',
      details: error.message,
    });
  }
});

app.post('/api/assistant/chat', async (req, res) => {
  try {
    const { userMessage, projectId, context, conversationHistory } = req.body;

    if (!userMessage) {
      return res.status(400).json({ error: 'Vui lòng cung cấp tin nhắn.' });
    }

    const contextString = context && Object.keys(context).length > 0
      ? JSON.stringify(context, null, 2)
      : 'Người dùng chưa cung cấp dữ liệu dự án.';

    const historyString = Array.isArray(conversationHistory) && conversationHistory.length > 0
      ? conversationHistory
          .slice(-8)
          .map((item) => `${item.role === 'user' ? 'Người dùng' : 'TaskHub AI'}: ${item.content}`)
          .join('\n')
      : 'Chưa có lịch sử hội thoại trước đó.';

    const systemInstruction = buildAssistantSystemInstruction(
      contextString,
      historyString,
    );

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: userMessage,
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        temperature: 0.45,
      },
    });

    const parsed = normalizeAssistantResponse(response.text);
    const technicalIds = collectTechnicalIds(context || {});

    res.json({
      reply: redactTechnicalIds(
        parsed.reply || 'Xin lỗi, tôi chưa đủ dữ liệu để tổng hợp câu trả lời lúc này.',
        technicalIds,
      ),
      suggestedActions: parsed.suggestedActions,
      projectId: projectId || '',
    });
  } catch (error) {
    console.error('Lỗi hệ thống Trợ lý AI:', error);
    res.status(500).json({
      error: 'Trợ lý AI đang bận xử lý dữ liệu, vui lòng thử lại sau nhé!',
      details: error.message,
    });
  }
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`TaskHub AI Backend is running at http://localhost:${PORT}`);
  });
}

module.exports = app;
