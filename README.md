# Flightdeck Plus

Bản fork của [Flightdeck](https://github.com/scasella/claude-flightdeck) (Stephen Casella, MIT): một mod Claude Code vẽ bảng điều khiển agent trực tiếp trong terminal: model chính, ngữ cảnh và chi phí, mọi lần kiểm tra quyền, subagent dạng thẻ hoặc làn. Mọi số đều lấy từ sự kiện phiên thật, không gửi gì ra ngoài. Giao diện tiếng Việt.

## Thêm gì so với bản gốc

- **Khung chính lớn**: model, nhánh git (`⎇`), effort, chế độ, rồi mỗi chỉ số một hàng có nhãn và thanh dày: `NGỮ CẢNH`, `5H`, `7D` (đổi sang vàng từ 60% và đỏ từ 85%, kèm token của cửa sổ và thời gian đến lúc reset), `CHI PHÍ`. Nhánh đọc từ `.git/HEAD` ở thư mục phiên (hỗ trợ cả worktree), cập nhật mỗi lượt.
- **Hộp `LẦN LÀM VIỆC · token`**: lượt hiện tại (hoặc lượt vừa xong) đã tốn bao nhiêu token: một hàng cho `main` và một hàng cho mỗi agent đã chạy trong lượt đó, mỗi hàng có thanh tỷ lệ và `vào / ra / cache`, cuối cùng là `tổng`. Sang lượt mới thì đếm lại. Thay cho bảng "lượt trước" và "nhật ký phiên" của bản gốc, hai bảng này đã bỏ.
- **Hộp `TOKEN · đã dùng`**: `hôm nay`, `tổng` (từ ngày dùng đầu tiên) và `cao nhất` (ngày dùng nhiều token nhất), mỗi dòng tách `vào / ra / cache`. Đếm mọi request của main, subagent và fork; lưu giữa các phiên.
- **Mascot Clawd**: khi main hoặc agent nào đó đang chạy, Clawd ngồi trước laptop mở, code cuộn trên màn hình, tay gõ phím. Khi rảnh, laptop gập lại, ly cà phê bốc khói, Clawd quay đầu nhìn quanh, chớp mắt, ngủ gật.
- **Chào và chú thích**: toast chào khi mở phiên; dưới mascot là `● Claude đang code · agent ◐ <tên>` lúc làm việc, hoặc lời chào theo giờ (`Chào buổi chiều, …!`) lúc rảnh.
- Ước tính tiến độ và thời gian còn lại của agent đang chạy, dựa trên các agent đã xong.

Phần còn lại (các bảng, phím tắt, lệnh `/flightdeck`, xử lý sự cố) giữ như bản gốc: xem [README của Flightdeck](https://github.com/scasella/claude-flightdeck#readme).

## Cài đặt

Trong Claude Code (2.1.289 trở lên), thay `<github-user>` bằng tên GitHub nơi bạn đặt repo này:

```
/plugin marketplace add <github-user>/claude-flightdeck-plus
/plugin install flightdeck-plus@flightdeck-plus
/reload-plugins
/flightdeck
```

Máy đã cài Flightdeck gốc (`flightdeck@claude-flightdeck`) thì gỡ hoặc tắt nó trong `/plugin` trước: hai bản dùng chung lệnh `/flightdeck` và cùng vẽ một pane.

Chạy thử từ bản tải về, không cần cài: `claude --plugin-dir ./claude-flightdeck-plus`.

## Nhập token đã dùng từ trước

Mod đếm từ lúc nó chạy lần đầu trên máy. Để `tổng` và `cao nhất` tính cả những phiên trước đó, mở Claude Code một lần với mod đã cài, thoát ra rồi chạy trong thư mục repo:

```
python3 scripts/import-history.py --dry-run   # chỉ in kết quả
python3 scripts/import-history.py             # lưu
```

Script cộng token trong log phiên (`~/.claude/projects`, hoặc `$CLAUDE_CONFIG_DIR/projects`) từ trước mốc mod bắt đầu đếm, theo ngày giờ máy, mỗi response một lần. Chạy lại an toàn: nó ghi đè, không cộng thêm. Cần Python 3.

Số token lưu riêng từng máy (`~/.claude/plugins/store/flightdeck-plus_*.json`), không đồng bộ giữa các máy.

## Cấu hình

Trong `/config`, hoặc `pluginConfigs["flightdeck-plus@flightdeck-plus"].options` trong `settings.json` người dùng. Các tùy chọn giống bản gốc, thêm:

| Option | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `userName` | trống | tên Clawd dùng để chào bạn; để trống thì chào chung |
| `panels` | `main,tokens,architect,gate,agents,loops,work` | các bảng theo thứ tự (`work` là hộp token của lần làm việc); bỏ một tên để ẩn bảng đó |
| `motion` | `while-active` | `off` tắt cả mascot lẫn đường nối động |

Trong layout inline (8 dòng phía trên ô nhập) chỉ có thêm `hôm nay X` ở dòng đầu và một dòng `lần này … token`; khung chính lớn, hộp token, mascot và lời chào nằm ở pane gắn cạnh, từ 28 cột.

## Phát triển

```
claude --plugin-dir .       # nạp mod, sửa là tự nạp lại
claude plugin validate .
claude plugin test .
```

Bộ test thừa hưởng từ bản gốc còn 19 test cũ khẳng định chuỗi tiếng Anh nên fail từ khi giao diện sang tiếng Việt; các test của phần thêm vào đều qua.

## Giấy phép

MIT, giữ nguyên bản quyền của tác giả gốc ([LICENSE](LICENSE)).
