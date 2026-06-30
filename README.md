# Minesweeper 🎮

Minesweeper เกมคลาสสิกพร้อม animation และลูกเล่นสุดปัง!

- ⭐ 9×9 กับระเบิด 10 ลูก
- 🎯 เปิดช่องแบบ flood fill
- 🚩 ปักธงคลิกขวา
- 💥 เอฟเฟกต์ระเบิด chain reaction
- 🎊 Confetti ตอนชนะ
- ✨ Particle พื้นหลัง + แสง shimmer

## วิธีเล่นออนไลน์ (GitHub Pages)

1. ไปที่ https://github.com/new
2. ตั้งชื่อ repo เช่น `minesweeper`
3. เลือก **Public**
4. คลิก **Create repository**
5. อัปโหลดไฟล์ `index.html` ผ่าน **Add file → Upload files**
6. ไปที่ **Settings → Pages**
7. ใต้ **Source** เลือก **Deploy from a branch**
8. เลือก **main** / **(root)** แล้วกะ **Save**
9. รอ 1-2 นาที แล้วเล่นได้ที่:  
   `https://<username>.github.io/<repo-name>/`

หรือใช้ GitHub Pages Action (auto-deploy ทุกครั้งที่ push):
- เปิด Actions tab → คลิก **Set up a workflow yourself**
- วาง `.github/workflows/deploy.yml` ด้านล่าง

```yaml
name: Deploy to Pages
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      pages: write
      id-token: write
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v4
      - uses: actions/upload-pages-artifact@v3
        with:
          path: '.'
      - uses: actions/deploy-pages@v4
```

## เปิดในเครื่อง

แค่เปิด `index.html` ในเบราว์เซอร์เลย
