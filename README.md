# TaskHub Backend

TaskHub Backend là dịch vụ Node.js/Express dùng cho hệ thống TaskHub AI. Backend này đảm nhiệm hai nhóm vai trò chính: xử lý các tính năng AI thông qua Gemini API và cung cấp API quản trị cho web admin.

## Chức năng chính

- Sinh danh sách task từ mô tả công việc
- Tóm tắt hội thoại trong task
- Xử lý hỏi đáp trợ lý AI theo ngữ cảnh dự án/task
- Chuẩn hóa kết quả AI trước khi trả về frontend
- Cung cấp API quản trị cho admin web
- Xác thực Firebase ID token và kiểm tra quyền `systemRole`

## Công nghệ sử dụng

- Node.js
- Express
- Firebase Admin SDK
- Google Gemini API
- Jest + Supertest

## Yêu cầu cấu hình

Repo cần có:

- file `.env` chứa `GEMINI_API_KEY`
- file `serviceAccountKey.json` để Firebase Admin SDK có thể truy cập Firestore và xác thực token

Ví dụ `.env` tối thiểu:

```env
GEMINI_API_KEY=your_gemini_api_key
PORT=3000
```

## Chạy local

```bash
npm install
npm start
```

Backend mặc định chạy tại `http://localhost:3000` nếu không truyền biến `PORT`.

## Các endpoint chính

### AI APIs

- `POST /api/generate-tasks`
- `POST /api/summarize-chat`
- `POST /api/assistant/action`
- `POST /api/assistant/chat`

### Admin APIs

- `GET /api/admin/stats`
- `GET /api/admin/users`
- `GET /api/admin/projects`
- `GET /api/admin/tasks`
- `PATCH /api/admin/users/:uid/role`
- `PATCH /api/admin/projects/:projectId/status`

Các endpoint admin yêu cầu Firebase ID token hợp lệ và tài khoản phải có `systemRole = admin` trong collection `USERS`.

## Chạy test

```bash
npm test
```

Một số lệnh hữu ích khác:

```bash
npm run test:unit
npm run test:api
npm run test:coverage
```

## Cấu trúc tệp chính

```text
index.js             # Định nghĩa API, middleware và router admin
assistantUtils.js    # Hàm xử lý, parse và chuẩn hóa dữ liệu AI
test/                # Unit test và integration test cho backend
```

## Liên kết hệ thống

Repo này là thành phần backend, đi kèm với:

- ứng dụng người dùng Flutter: `AI-TaskHub`
- giao diện quản trị web: `taskhub-admin`