# ScriptForge

ScriptForge là app tự động hóa workflow viết kịch bản YouTube storytelling trên Claude.ai.
App mở trình duyệt Claude, giữ phiên đăng nhập, gửi prompt theo từng bước, chờ Claude trả lời và hiển thị tiến trình ngay trong giao diện.

## Tải Bản Windows

[![Tải ScriptForge cho Windows](https://img.shields.io/badge/T%E1%BA%A3i%20ScriptForge-Windows%20Portable-8b5cf6?style=for-the-badge&logo=windows&logoColor=white)](https://github.com/kitikt/ScriptForce/releases/latest)

Với người dùng không biết Git, Node.js hoặc CMD:

1. Vào trang Releases bằng nút tải ở trên.
2. Tải file zip Windows portable mới nhất.
3. Giải nén file zip.
4. Mở `ScriptForge.exe`.
5. Bấm `Kết nối trình duyệt`.
6. Đăng nhập Claude.ai, chọn project và chạy pipeline.

Lưu ý: khi phát hành cho người dùng, hãy zip nguyên thư mục `ScriptForge-win32-x64`, không chỉ gửi riêng file `ScriptForge.exe`.

## Dành Cho Người Phát Triển

Yêu cầu:

- Node.js 18+
- Tài khoản Claude.ai

Cài đặt:

```bash
git clone https://github.com/kitikt/ScriptForce.git
cd ScriptForce
npm run setup
```

Chạy bản dev:

```bash
npm run dev
```

Địa chỉ mặc định:

```text
Client: http://localhost:5173
Server: http://localhost:3001
```

## Build Windows Portable

Tạo bản portable cho Windows:

```bash
npm run portable:win
```

Kết quả nằm ở:

```text
release-portable-clean/ScriptForge-win32-x64/
```

Mở app bằng:

```text
release-portable-clean/ScriptForge-win32-x64/ScriptForge.exe
```

Trước khi build lại, hãy đóng mọi cửa sổ ScriptForge đang mở để tránh Windows khóa file.

## Tính Năng Chính

- Điều khiển Claude.ai qua browser thật.
- Lưu phiên đăng nhập Claude để lần sau không cần login lại nếu session còn hiệu lực.
- Hỗ trợ nhiều profile tài khoản Claude.
- Chạy tối đa 2 pipeline song song.
- Chọn project, model và trạng thái Adaptive Thinking.
- Theo dõi log và tiến trình pipeline theo thời gian thực.
- Kiểm tra usage Claude.
- Tùy chỉnh, thêm, sửa step prompt.
- Export kết quả ra file txt.
- Bản Windows portable không cần Git, Node.js hoặc CMD cho người dùng cuối.

## Cấu Trúc Dự Án

```text
scriptforge/
|-- client/                  React/Vite UI
|-- server/                  Express, Socket.IO, Playwright automation
|-- electron/                Desktop portable entry
|-- scripts/                 Script build và cài browser local
|-- docs/                    Tài liệu sử dụng/build
|-- package.json             Script root
`-- README.md
```

## Ghi Chú Phát Hành

Để nút tải Windows hoạt động đúng cho người dùng cuối:

1. Chạy `npm run portable:win`.
2. Zip thư mục `release-portable-clean/ScriptForge-win32-x64`.
3. Tạo GitHub Release mới.
4. Upload file zip vào Release đó.

Sau khi có Release, nút tải trong README sẽ đưa người dùng đến bản mới nhất.

## License

MIT
