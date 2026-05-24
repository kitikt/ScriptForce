# ScriptForge Windows Portable

Ban portable khong can cai dat Git, Node.js, npm hay mo CMD.

## Tao ban portable

Tren may build, chay:

```powershell
npm run portable:win
```

Ket qua nam o:

```text
release-portable-clean/ScriptForge-win32-x64/
```

## Dua cho nguoi dung

Nen nen toan bo thu muc `ScriptForge-win32-x64` thanh file `.zip`.
Nguoi dung chi can:

1. Giai nen file zip.
2. Mo thu muc `ScriptForge-win32-x64`.
3. Bam dup `ScriptForge.exe`.
4. Bam `Ket noi trinh duyet`.
5. Dang nhap Claude.ai.
6. Chon project va chay pipeline.

## Luu y

- Khong xoa cac file ben trong thu muc portable, vi `ScriptForge.exe` can cac file di kem.
- Du lieu dang nhap Claude duoc luu trong thu muc du lieu cua app tren Windows, khong dong goi san trong file build.
- Neu Windows hien canh bao bao mat, chon More info roi Run anyway cho ban test noi bo.
- Ban portable hien tai la dang folder portable, khong phai installer.
