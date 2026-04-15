require('dotenv').config();
const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const { GoogleGenAI } = require('@google/genai');

// 1. Khởi tạo quyền lực tối cao với Firebase
const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

// 2. Khởi tạo Bộ não Gemini AI
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// 3. Cấu hình Server Web
const app = express();
app.use(cors()); 
app.use(express.json()); 

// --- ROUTE KIỂM TRA SERVER ---
app.get('/', (req, res) => {
  res.send('🚀 TaskHub AI Backend đang hoạt động cực kỳ mượt mà!');
});

// ==========================================
// KHU VỰC DÀNH CHO CÁC TÍNH NĂNG AI SẼ VIẾT
// ==========================================

// Tính năng 1: AI Smart Task Generator (Chia việc tự động)
app.post('/api/generate-tasks', async (req, res) => {
  try {
    const { prompt } = req.body;
    
    if (!prompt) {
      return res.status(400).json({ error: 'Vui lòng cung cấp mô tả công việc' });
    }

    console.log(`🤖 Nhận yêu cầu phân tích: "${prompt}"`);

    // 1. Chuẩn bị câu lệnh "ép" Gemini trả về đúng chuẩn JSON
    const aiPrompt = `
      Bạn là một chuyên gia quản lý dự án (Project Manager) xuất sắc. 
      Nhiệm vụ của bạn là đọc yêu cầu sau: "${prompt}".
      Hãy chia nhỏ yêu cầu này thành 3 đến 5 công việc (sub-tasks) cụ thể cần thực hiện.
      
      QUAN TRỌNG: Bạn CHỈ ĐƯỢC PHÉP trả về kết quả dưới dạng một mảng JSON hợp lệ, không kèm theo bất kỳ văn bản giải thích hay định dạng markdown (như \`\`\`json) nào khác.
      Cấu trúc chuẩn:
      [
        { "title": "Tên công việc ngắn gọn", "description": "Mô tả chi tiết những việc cần làm", "priority": "High" },
        { "title": "Tên công việc 2", "description": "Mô tả...", "priority": "Medium" }
      ]
      (Ưu tiên priority chỉ lấy 1 trong 3 chữ: High, Medium, Low).
    `;

    // 2. Gọi Gemini 2.5 suy nghĩ
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: aiPrompt,
    });

    // 3. Làm sạch dữ liệu cực mạnh (phòng trường hợp AI nói nhảm)
    let rawText = response.text;
    
    // Tìm vị trí của dấu ngoặc vuông [ ] để bóc tách đúng mảng JSON
    const startIndex = rawText.indexOf('[');
    const endIndex = rawText.lastIndexOf(']');
    
    if (startIndex === -1 || endIndex === -1) {
      throw new Error("AI không trả về định dạng mảng JSON hợp lệ.");
    }
    
    rawText = rawText.substring(startIndex, endIndex + 1);

    // 4. Chuyển thành mảng và gửi về cho Flutter
    const tasksArray = JSON.parse(rawText);
    res.json({ success: true, tasks: tasksArray });

  } catch (error) {
    console.error('❌ Lỗi Gemini:', error);
    res.status(500).json({ error: 'AI đang bận, vui lòng thử lại sau!', details: error.message });
  }
});

// Tính năng 2: AI Chat Summarizer (Tóm tắt hội thoại)
app.post('/api/summarize-chat', async (req, res) => {
  try {
    const { messages } = req.body; // Lấy mảng tin nhắn từ Flutter gửi lên
    
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Không có tin nhắn nào để tóm tắt' });
    }

    // Ghép mảng tin nhắn thành một đoạn văn bản dễ đọc
    // Dạng: "độ: Alo Vũ à Vũ"
    const chatLog = messages.map(m => `${m.sender}: ${m.content}`).join('\n');

    console.log(`🤖 Đang tóm tắt ${messages.length} tin nhắn...`);

    // 2. Lệnh Prompt cho Gemini
    const aiPrompt = `
      Bạn là một trợ lý quản lý dự án thông minh. Hãy đọc đoạn hội thoại sau giữa các thành viên:
      
      [Bắt đầu đoạn chat]
      ${chatLog}
      [Kết thúc đoạn chat]

      Nhiệm vụ của bạn:
      1. Tóm tắt lại ngắn gọn các vấn đề đã được thảo luận.
      2. Chốt lại các quyết định cuối cùng.
      3. Liệt kê rõ ai được phân công làm việc gì (nếu có).
      
      Hãy trình bày rõ ràng, dùng gạch đầu dòng, ngôn ngữ tự nhiên và thân thiện. Không cần giải thích thêm.
    `;

    // call gaymini
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: aiPrompt,
    });

    // 4. Trả kết quả về cho điện thoại
    res.json({ success: true, summary: response.text });

  } catch (error) {
    console.error('❌ Lỗi Gemini:', error);
    res.status(500).json({ error: 'AI đang bận, vui lòng thử lại sau!' });
  }
});


// 4. Bật công tắc cho Server chạy
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n=========================================`);
  console.log(`🚀 Server đã sẵn sàng tại: http://localhost:${PORT}`);
  console.log(`🧠 Gemini AI đã được kết nối!`);
  console.log(`=========================================\n`);
});