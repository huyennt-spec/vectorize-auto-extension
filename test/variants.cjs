// Các kiểu trang Download khác nhau mà web thật có thể có (mỗi kiểu từng làm bản 1.5.1 đứng ở bước Download).
// Chạy: npm install && node test/variants.cjs
const assert = require('assert');
const { launch, sleep, HOME } = require('./harness.cjs');

(async () => {
  const t = await launch();
  const { page, downloads, mock } = t;
  const fresh = async (mode) => {
    await page.goto(HOME);
    await t.setMode(mode);
    await page.goto(HOME);
    await sleep(500);
  };

  // 1) Nút <a href="#"> chỉ hoạt động sau 2,5 giây: lần bấm đầu hụt → phải bấm lại, và chỉ tải 1 file.
  await fresh('late');
  await t.drop('late.png');
  await t.expectDownloads(1, 30000, 'late');
  assert.strictEqual(downloads[0], 'late.svg');
  console.log('✔ 1. Nút chỉ chạy sau khi trang gắn xong: bấm lại, tải đúng 1 file');

  // 2) Script của trang (defer) tải chậm 1,5 giây: chờ trang tải xong rồi mới bấm.
  mock.deferMs = 1500;
  await fresh('defer');
  await t.drop('defer.png');
  await t.expectDownloads(2, 30000, 'defer');
  assert.strictEqual(downloads[1], 'defer.svg');
  assert.strictEqual(await page.evaluate(() => window.__mainClicks), 1, 'chỉ bấm 1 lần');
  mock.deferMs = 0;
  console.log('✔ 2. Script trang tải chậm: chờ trang xong mới bấm, bấm 1 lần');

  // 3) Mọi ảnh dùng chung trang /dlpage?img=… : ảnh thứ 2, 3 vẫn được tải.
  await fresh('query');
  await t.drop('q-a.png');
  await t.expectDownloads(3, 20000, 'query a');
  await page.waitForURL(/\/dlpage\?img=/);
  await sleep(1500);
  await t.drop('q-b.png'); // Kéo ngay trên trang Download của ảnh trước
  await t.expectDownloads(4, 20000, 'query b');
  await page.goto(HOME);
  await sleep(500);
  await t.drop('q-c.png');
  await t.expectDownloads(5, 20000, 'query c');
  assert.deepStrictEqual(downloads.slice(2), ['q-a.svg', 'q-b.svg', 'q-c.svg']);
  console.log('✔ 3. Trang Download dùng chung địa chỉ: ảnh sau vẫn tải');

  // 3b) Cũng kiểu đó, kéo ảnh lớn vào trang Download của ảnh trước (Pre-Crop, web thu nhỏ ảnh 2,5 giây):
  // không được tải lại ảnh trước.
  await page.waitForURL(/\/dlpage\?img=/);
  await sleep(1500);
  await t.drop('big-q-d.png');
  await t.expectDownloads(6, 25000, 'query big');
  assert.strictEqual(downloads[5], 'big-q-d.svg', `tải nhầm: ${downloads[5]}`);
  console.log('✔ 3b. …và không tải lại ảnh trước');

  // 4) Trang Download hiện ngay trong trang kết quả (địa chỉ chỉ đổi phần #download).
  await fresh('hash');
  await t.drop('h-a.png');
  await t.expectDownloads(7, 20000, 'hash');
  assert.strictEqual(downloads[6], 'h-a.svg');
  console.log('✔ 4. Trang Download dạng #download trong cùng trang');

  // 5) Trang liên tục vẽ lại nút Download trong 3 giây đầu.
  await fresh('churn');
  await t.drop('c-a.png');
  await t.expectDownloads(8, 25000, 'churn');
  assert.strictEqual(downloads[7], 'c-a.svg');
  console.log('✔ 5. Nút bị vẽ lại liên tục');

  // 6) Đang làm ảnh thì chuyển sang trang một ảnh cũ: không được bấm tải ảnh cũ đó;
  //    kéo ảnh mới vào sau đó thì làm ảnh mới ngay (không bị xếp hàng sau ảnh bị bỏ dở).
  await fresh('');
  await t.drop('nav-a.png');
  await page.waitForURL(/\/images\//, { timeout: 8000 });
  await sleep(1000);
  await page.goto(`${HOME}images/555-old.png`);
  await sleep(6000);
  assert.strictEqual(downloads.length, 8, `tải nhầm ảnh cũ: ${downloads.join(', ')}`);
  await page.goto(HOME);
  await sleep(500);
  await t.drop('nav-b.png');
  await t.expectDownloads(9, 20000, 'ảnh mới sau khi chuyển trang');
  assert.strictEqual(downloads[8], 'nav-b.svg');
  console.log('✔ 6. Chuyển sang ảnh cũ giữa chừng: không tải nhầm, ảnh mới vẫn được làm');

  await t.context.close();
  console.log('Tất cả đều qua.');
})().catch((e) => { console.error('✘', e); process.exit(1); });
