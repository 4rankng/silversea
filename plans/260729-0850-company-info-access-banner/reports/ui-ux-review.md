# UI/UX review — nhắc cấu hình thông tin công ty

## Kết luận

Hướng UX phù hợp với dashboard vận hành: dùng lại `Banner`, biến thể `warning`,
không sticky, không cho đóng, chỉ hiện khi `companyInfo.updatedAt === null`.
Dashboard hiện chỉ dành cho `ADMIN`, `MANAGER`, `ACCOUNTANT`, nên không cần thêm
logic role trong component banner.

Nên chốt nội dung và hành vi như sau.

## Copy chính thức

- Tiêu đề: **Chưa cấu hình thông tin công ty.**
- Nội dung: **Bổ sung thông tin pháp lý, liên hệ và tài khoản ngân hàng để chứng từ xuất ra đầy đủ.**
- Nhãn hành động: **Bổ sung thông tin**
- Đích: `/config/company-info`

Lý do:

- Dùng đúng tên màn hình `Thông tin công ty`; tránh đổi thuật ngữ sang “hồ sơ”
  chỉ tại dashboard.
- Bao quát đủ nhóm trường bắt buộc trên form: pháp lý, đại diện, liên hệ, ngân
  hàng. Copy hiện tại chỉ liệt kê tên/địa chỉ/MST/liên hệ, dễ tạo kỳ vọng rằng
  điền bốn nhóm đó là đủ.
- `Bổ sung thông tin` mô tả đúng hành động và rõ hơn `Cấu hình ngay`; không dùng
  cảm giác thúc ép cho một cảnh báo thiết lập.

Markup đề xuất:

```tsx
<strong>Chưa cấu hình thông tin công ty.</strong>{' '}
Bổ sung thông tin pháp lý, liên hệ và tài khoản ngân hàng để chứng từ xuất ra đầy đủ.
```

CTA là điều hướng, nên dùng `<Link to="/config/company-info">` mang style
`wf-banner-action`, không dùng `<button onClick={navigate}>`. Như vậy giữ đúng
semantics và hỗ trợ mở tab mới bằng chuột giữa/Cmd/Ctrl.

## Placement và ưu tiên

- Đặt trong `.dash-wf`, trước page header/KPI để người dùng thấy trước khi đọc
  số liệu.
- `sticky={false}`: đúng. Đây là nhắc thiết lập, không nên che nội dung khi cuộn.
- Khi đồng thời có cảnh báo công nợ `danger`, hiển thị `danger` trước,
  company-info `warning` sau. Severity cấp thời gian phải đứng trước nhắc cấu
  hình thường trực.
- Giữ banner full-width theo content area; không bọc thêm card, shadow hoặc
  gradient.

## Dismissibility và trạng thái

- `nonDismissable`: bắt buộc. Nếu cho đóng, người dùng có thể ẩn vĩnh viễn một
  yêu cầu chưa hoàn tất.
- Không dùng `dismissKey` hay localStorage.
- Chỉ hiện khi request đã có dữ liệu và `updatedAt === null`.
- Không hiện khi `data === undefined`/đang tải để tránh chớp cảnh báo sai.
- Không suy diễn từ field rỗng. `updatedAt` persisted là authority duy nhất.
- Sau save thành công và query được cập nhật/invalidate, banner biến mất. Nếu
  thay đổi đang chờ governance và `updatedAt` vẫn null, banner tiếp tục hiện là
  đúng.

## Desktop / tablet / mobile

Desktop:

- Icon, message, CTA cùng một hàng.
- Text được wrap, không truncate.
- CTA nằm bên phải, không giành chiều rộng cố định quá lớn.
- Không thêm animation; banner tải bất đồng bộ không nên gây chuyển động gây
  nhiễu.

Mobile `<= 640px`:

- Message ở hàng đầu; CTA xuống hàng riêng.
- Padding ngang 12px; icon canh đầu dòng khi message nhiều dòng.
- CTA cao tối thiểu 44px. Nên cho CTA chiếm toàn bộ phần rộng còn lại của hàng
  hành động để dễ chạm; không để text hoặc nút tạo horizontal overflow ở 320px.
- Giữ khoảng thụt của hàng CTA thẳng với message (sau icon), hoặc bỏ thụt và
  cho CTA full-width; không căn lửng giữa hai trục.
- Kiểm tra thực tế ở 320px, 390px, 768px và zoom 200%.

## Accessibility

- `role="status"` của `Banner` phù hợp: cảnh báo xuất hiện sau query sẽ được
  thông báo lịch sự, không cướp focus.
- Icon `Building2` là trang trí; `aria-hidden` hiện có đúng.
- CTA phải là `<Link>` có focus-visible rõ và vùng chạm tối thiểu 44px trên
  mobile.
- Không dùng màu vàng làm tín hiệu duy nhất: tiêu đề và nội dung đã nêu rõ trạng
  thái.
- Warning foreground/background phải giữ contrast WCAG AA 4.5:1 cho text; focus
  outline tối thiểu 2px.
- Không tự chuyển focus vào banner. Khi người dùng kích hoạt CTA, route đích
  cần có heading `Thông tin công ty` trong reading order.

## Review bản đề xuất hiện tại

Đạt:

- Dùng lại shared `Banner`, `warning`, `Building2`.
- `sticky={false}`, `nonDismissable`.
- Guard `!companyInfo || companyInfo.updatedAt`.
- Banner đứng trước header và không xuất hiện giả khi query chưa có data.
- Mobile đã wrap action và tăng chiều cao CTA.

Cần chỉnh:

1. Copy sang bản chính thức ở trên.
2. Đổi action từ button điều hướng sang `Link`.
3. Nếu cả hai banner cùng hiện, đưa cảnh báo công nợ `danger` lên trước.
4. Mobile nên xác nhận CTA full-row và không overflow tại 320px.

## Unresolved questions

Không có.
