require('dotenv').config();

const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const { GoogleGenAI } = require('@google/genai');

const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const app = express();

app.use(cors());
app.use(express.json());

const ALLOWED_SUGGESTED_ACTIONS = [
  'SUMMARIZE',
  'CREATE_TASK',
  'FIND_TASK',
  'PRIORITIZE',
];

function normalizeSuggestedActions(actions) {
  if (!Array.isArray(actions)) return [];

  return actions
    .map((action) => String(action || '').trim().toUpperCase())
    .filter((action) => ALLOWED_SUGGESTED_ACTIONS.includes(action))
    .filter((action, index, array) => array.indexOf(action) === index)
    .slice(0, 4);
}

function parseJsonFromText(rawText, fallbackValue) {
  if (!rawText || typeof rawText !== 'string') return fallbackValue;

  try {
    return JSON.parse(rawText);
  } catch (error) {
    const firstObject = rawText.indexOf('{');
    const lastObject = rawText.lastIndexOf('}');
    const firstArray = rawText.indexOf('[');
    const lastArray = rawText.lastIndexOf(']');

    const canReadObject =
      firstObject !== -1 && lastObject !== -1 && lastObject > firstObject;
    const canReadArray =
      firstArray !== -1 && lastArray !== -1 && lastArray > firstArray;

    if (canReadArray && (!canReadObject || firstArray < firstObject)) {
      return JSON.parse(rawText.substring(firstArray, lastArray + 1));
    }

    if (canReadObject) {
      return JSON.parse(rawText.substring(firstObject, lastObject + 1));
    }

    throw error;
  }
}

function normalizeAssistantResponse(rawText) {
  const parsed = parseJsonFromText(rawText, {});

  return {
    reply: typeof parsed.reply === 'string' ? parsed.reply.trim() : '',
    suggestedActions: normalizeSuggestedActions(parsed.suggestedActions),
  };
}

function normalizeGeneratedTasks(rawTasks) {
  if (!Array.isArray(rawTasks)) return [];

  return rawTasks
    .slice(0, 5)
    .map((task) => ({
      title: String(task.title || '').trim(),
      description: String(task.description || '').trim(),
      priority: ['High', 'Medium', 'Low'].includes(task.priority)
        ? task.priority
        : 'Medium',
    }))
    .filter((task) => task.title.length > 0);
}

function normalizeTaskInsights(rawTasks) {
  if (!Array.isArray(rawTasks)) return [];

  return rawTasks
    .slice(0, 8)
    .map((task, index) => ({
      title: String(task.title || task.taskName || '').trim(),
      projectName: String(task.projectName || '').trim(),
      status: String(task.status || '').trim(),
      priority: String(task.priority || '').trim(),
      dueDate: String(task.dueDate || '').trim(),
      reason: String(task.reason || task.matchReason || '').trim(),
      rank: Number.isInteger(task.rank) ? task.rank : index + 1,
    }))
    .filter((task) => task.title.length > 0);
}

function buildAssistantActionInstruction(action, contextString, historyString) {
  if (action === 'CREATE_TASK') {
    return `Ban la TaskHub AI, tro ly quan ly du an cong nghe.

DU LIEU HE THONG:
${contextString}

LICH SU HOI THOAI GAN DAY:
${historyString}

Nhiem vu: De xuat cac task moi co the tao dua tren du lieu tren.
Quy tac:
- Chi dua tren context va lich su hoi thoai duoc cung cap. Neu thieu du lieu, tra ve mang tasks rong va noi ro ly do trong "reply".
- Khong bia deadline, nguoi thuc hien, trang thai hoac ten du an.
- Moi task can ro rang, co the thuc hien duoc, uu tien 1 den 5 task.
- priority chi duoc la "High", "Medium" hoac "Low".
- Luon tra ve JSON hop le dung cau truc: {"reply":"...","tasks":[{"title":"...","description":"...","priority":"Medium"}]}. Khong boc markdown.`;
  }

  if (action === 'FIND_TASK') {
    return `Ban la TaskHub AI, tro ly quan ly du an cong nghe.

DU LIEU HE THONG:
${contextString}

LICH SU HOI THOAI GAN DAY:
${historyString}

Nhiem vu: Tim cac task phu hop nhat voi nhu cau gan day cua nguoi dung.
Quy tac:
- Chi tim trong "all_tasks_list" hoac "task" duoc cung cap, khong bia task.
- Neu khong co task phu hop hoac thieu du lieu, tra ve tasks rong va noi ro ly do trong "reply".
- Uu tien task trung voi ten, du an, trang thai, deadline, priority hoac noi dung nguoi dung vua hoi.
- Tra ve toi da 8 task.
- Luon tra ve JSON hop le dung cau truc: {"reply":"...","tasks":[{"title":"...","projectName":"...","status":"...","priority":"...","dueDate":"...","reason":"..."}]}. Khong boc markdown.`;
  }

  if (action === 'PRIORITIZE') {
    return `Ban la TaskHub AI, tro ly quan ly du an cong nghe.

DU LIEU HE THONG:
${contextString}

LICH SU HOI THOAI GAN DAY:
${historyString}

Nhiem vu: Sap xep cac task nen uu tien xu ly truoc.
Quy tac:
- Chi dua tren "all_tasks_list" hoac "task" duoc cung cap, khong bia task.
- Uu tien theo deadline gan/qua han, priority cao, task dang lam, task co rui ro chan tien do.
- Neu thieu du lieu de xep hang, tra ve prioritizedTasks rong va noi ro ly do trong "reply".
- Tra ve toi da 8 task, co "rank" va "reason" ngan gon.
- Luon tra ve JSON hop le dung cau truc: {"reply":"...","prioritizedTasks":[{"rank":1,"title":"...","projectName":"...","status":"...","priority":"...","dueDate":"...","reason":"..."}]}. Khong boc markdown.`;
  }

  return `Ban la TaskHub AI, tro ly quan ly du an cong nghe.

DU LIEU HE THONG:
${contextString}

LICH SU HOI THOAI GAN DAY:
${historyString}

Nhiem vu: Tom tat noi dung quan trong tu du lieu tren.
Quy tac:
- Chi dua tren context va lich su hoi thoai duoc cung cap.
- Neu thieu du lieu, noi ro chua du du lieu, khong bia thong tin.
- Tap trung vao van de da thao luan, quyet dinh, viec can lam tiep theo.
- Luon tra ve JSON hop le dung cau truc: {"summary":"..."}. Khong boc markdown.`;
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
4. Nếu phù hợp, gợi ý tối đa 4 hành động trong danh sách sau: ${ALLOWED_SUGGESTED_ACTIONS.join(', ')}.
5. Luôn trả về JSON hợp lệ đúng cấu trúc: {"reply":"...","suggestedActions":["SUMMARIZE"]}. Không bọc markdown, không thêm field khác.`;
}

app.get('/', (req, res) => {
  res.send('TaskHub AI Backend đang hoạt động!');
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

    const tasks = tasksArray.slice(0, 5).map((task) => ({
      title: String(task.title || 'Task mới').trim(),
      description: String(task.description || '').trim(),
      priority: ['High', 'Medium', 'Low'].includes(task.priority)
        ? task.priority
        : 'Medium',
    }));

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
      return res.status(400).json({ error: 'Hanh dong khong hop le.' });
    }

    const contextString = context && Object.keys(context).length > 0
      ? JSON.stringify(context, null, 2)
      : 'Nguoi dung chua cung cap du lieu du an.';

    const historyString = Array.isArray(conversationHistory) && conversationHistory.length > 0
      ? conversationHistory
          .slice(-8)
          .map((item) => `${item.role === 'user' ? 'Nguoi dung' : 'TaskHub AI'}: ${item.content}`)
          .join('\n')
      : 'Chua co lich su hoi thoai truoc do.';

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        SUMMARIZE: 'Tom tat noi dung hien tai.',
        CREATE_TASK: 'De xuat danh sach task moi co the tao.',
        FIND_TASK: 'Tim cac task phu hop nhat.',
        PRIORITIZE: 'Sap xep cac task nen uu tien xu ly.',
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

    if (normalizedAction === 'FIND_TASK') {
      return res.json({
        action: normalizedAction,
        reply: typeof parsed.reply === 'string'
          ? parsed.reply.trim()
          : 'Toi da tim cac task phu hop nhat tu du lieu hien co.',
        tasks: normalizeTaskInsights(parsed.tasks),
        projectId: projectId || '',
      });
    }

    if (normalizedAction === 'PRIORITIZE') {
      return res.json({
        action: normalizedAction,
        reply: typeof parsed.reply === 'string'
          ? parsed.reply.trim()
          : 'Toi da sap xep cac task nen uu tien tu du lieu hien co.',
        prioritizedTasks: normalizeTaskInsights(parsed.prioritizedTasks),
        projectId: projectId || '',
      });
    }

    if (normalizedAction === 'CREATE_TASK') {
      return res.json({
        action: normalizedAction,
        reply: typeof parsed.reply === 'string'
          ? parsed.reply.trim()
          : 'Toi da de xuat mot so task co the tao.',
        tasks: normalizeGeneratedTasks(parsed.tasks),
        projectId: projectId || '',
      });
    }

    return res.json({
      action: normalizedAction,
      summary: typeof parsed.summary === 'string'
        ? parsed.summary.trim()
        : 'Chua du du lieu de tom tat.',
      projectId: projectId || '',
    });
  } catch (error) {
    console.error('Loi he thong Assistant action:', error);
    res.status(500).json({
      error: 'Tro ly AI dang ban xu ly hanh dong, vui long thu lai sau nhe!',
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

    res.json({
      reply: parsed.reply || 'Xin lỗi, tôi chưa đủ dữ liệu để tổng hợp câu trả lời lúc này.',
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
app.listen(PORT, () => {
  console.log(`TaskHub AI Backend is running at http://localhost:${PORT}`);
});
