# ScriptForge
Tool tự động hóa viết kịch bản YouTube storytelling trên Claude.ai bằng browser automation.

## Vấn đề giải quyết
Viết kịch bản thủ công thường mất 1-2 tiếng vì phải copy paste prompt qua lại, chờ Claude trả lời, rồi gửi tiếp prompt kế tiếp.
ScriptForge thay thế luồng lặp đó bằng một pipeline tự động.
Bạn paste kịch bản gốc, bấm 1 nút, rồi có thể đi làm việc khác trong lúc tool chạy.

## Cách hoạt động
ScriptForge dùng Playwright để điều khiển Chromium, tự vào Claude.ai, tự gửi 8 prompt tuần tự, tự chờ response, rồi trả trạng thái và kết quả về web app qua WebSocket.
Phiên đăng nhập được lưu trong profile Chromium để lần sau không cần login lại nếu session còn hiệu lực.

## Cài đặt nhanh
Yêu cầu:

- Node.js 18+
- Tài khoản Claude.ai

Clone project rồi chạy setup ở thư mục root:

```bash
git clone https://github.com/kitikt/ScriptForce.git
cd ScriptForce
npm run setup
```

Lệnh `npm run setup` sẽ tự cài dependency cho root, `client`, `server` và cài Chromium cho Playwright.

Chạy project:

```bash
npm run dev
```

Địa chỉ mặc định:

```text
Client: http://localhost:5173
Server: http://localhost:3001
```

Nếu đã từng clone trước đó và chỉ muốn sửa lỗi thiếu `vite` / `express`, chạy lại từ root:

```bash
npm run setup
```

Hoặc cài từng phần thủ công:

```bash
npm install
npm --workspace client install
npm --workspace server install
npm run browsers:install
```

## Sử dụng
1. Mở `http://localhost:5173`.
2. Bấm `Connect Browser`.
3. Lần đầu cần login Claude.ai trong cửa sổ Chromium được mở ra.
4. Sau khi login xong, quay lại web app.
5. Chọn project, model và chat name.
6. Paste kịch bản gốc.
7. Bấm `Start Pipeline`.
8. Theo dõi tiến độ và kết quả trên giao diện.

Lần sau ScriptForge tự nhớ phiên đăng nhập nếu session Claude.ai vẫn còn hiệu lực.

## Cấu trúc thư mục
```text
scriptforge/
|-- README.md                  tài liệu dự án
|-- package.json               script chạy chung
|-- package-lock.json          lockfile root
|-- client/                    web app React
|   |-- src/                   mã nguồn frontend
|   |-- src/components/        component giao diện
|   |-- src/components/ui/     component UI nền
|   |-- src/lib/               tiện ích frontend
|   `-- package.json           dependency client
`-- server/                    backend automation
    |-- index.js               server Express và WebSocket
    |-- automation/            logic điều khiển browser
    |-- prompts/               template prompt
    |-- browser-data/          profile Chromium đã login
    `-- package.json           dependency server
```

## Tính năng
- Điều khiển Chromium bằng Playwright
- Kết nối Claude.ai qua browser thật
- Lưu phiên đăng nhập trong browser profile
- Gửi 8 prompt theo thứ tự cố định
- Chờ Claude trả lời trước khi chạy bước tiếp theo
- Hiển thị trạng thái pipeline theo thời gian thực
- Gửi log từ server về client qua WebSocket
- Hiển thị kết quả từng bước trong web app
- Hỗ trợ cấu hình project, model và chat name
- Tách frontend và backend rõ ràng

## Roadmap
- [x] Web app điều khiển pipeline
- [x] Backend Express
- [x] WebSocket realtime
- [x] Playwright Chromium automation
- [x] Lưu browser session
- [x] Pipeline 8 prompt
- [x] Hiển thị log và trạng thái từng bước
- [ ] Export kết quả ra file
- [ ] Quản lý nhiều bộ prompt
- [ ] Tùy chỉnh số bước pipeline
- [ ] Hàng đợi nhiều kịch bản
- [ ] Retry khi Claude trả lời lỗi hoặc timeout
- [ ] Đóng gói chạy production

## License
MIT
