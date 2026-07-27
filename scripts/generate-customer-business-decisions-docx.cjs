const fs = require("fs");
const path = require("path");
const {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  LevelFormat,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} = require("docx");

const outputPath = path.resolve(
  __dirname,
  "../docs/Xac-nhan-nghiep-vu-SilverSea-2026-07-27.docx",
);

const COLORS = {
  navy: "17365D",
  blue: "1F4E78",
  sky: "D9EAF7",
  pale: "EEF5FA",
  green: "E2F0D9",
  greenText: "375623",
  amber: "FFF2CC",
  amberText: "7F6000",
  red: "FCE4D6",
  redText: "9C0006",
  gray: "666666",
  lightGray: "F2F2F2",
  line: "B4C7E7",
  white: "FFFFFF",
  black: "1F1F1F",
};

const qs = [
  {
    group: "A. Công nợ phải thu và nhắc thanh toán",
    id: "Q01",
    title: "Ngưỡng cảnh báo sớm hạn mức công nợ",
    question:
      "Cảnh báo sớm ở bao nhiêu phần trăm hạn mức, dùng chung hay cấu hình riêng cho từng khách hàng?",
    proposal:
      "Mặc định 80%; cảnh báo vượt tại 100%; cho phép cấu hình riêng từng khách hàng. Giá trị kiểm tra gồm dư nợ hiện tại, khoản đã duyệt chưa thu và giá trị dự kiến của lô/chuyến mới.",
  },
  {
    group: "A. Công nợ phải thu và nhắc thanh toán",
    id: "Q02",
    title: "Phê duyệt tiếp tục dịch vụ khi vượt hạn mức",
    question:
      "Ai được cho phép tiếp tục cung cấp dịch vụ và có phân cấp theo tỷ lệ/số tiền vượt không?",
    proposal:
      "CUS và điều vận không tự duyệt. Trưởng phòng Tài chính/Kế toán duyệt phần vượt không quá 10% và trong ngưỡng tiền cấu hình; Giám đốc duyệt trường hợp lớn hơn hoặc lặp lại. Mỗi duyệt có lý do, phạm vi và ngày hết hạn.",
  },
  {
    group: "A. Công nợ phải thu và nhắc thanh toán",
    id: "Q03",
    title: "Phân bổ tiền về khi khách không chỉ định",
    question:
      "Phân bổ theo khoản nào và xử lý tiền thừa ra sao?",
    proposal:
      "Ưu tiên chỉ dẫn của khách. Nếu không có, phân bổ khoản đến hạn cũ nhất; cùng ngày thì theo ngày phát hành cũ nhất. Tiền thừa giữ chưa phân bổ, chỉ hoàn trả khi có yêu cầu và phê duyệt.",
  },
  {
    group: "A. Công nợ phải thu và nhắc thanh toán",
    id: "Q04",
    title: "Lịch nhắc thanh toán",
    question:
      "Nhắc ở mốc nào, trong khung giờ nào và xử lý cuối tuần/ngày lễ thế nào?",
    proposal:
      "Trước hạn 3 ngày, đúng hạn, sau hạn 3 ngày, sau đó mỗi 7 ngày; chỉ gửi 08:00–17:30 ngày làm việc. Lịch rơi vào ngày nghỉ chuyển 09:00 ngày làm việc kế tiếp; tối đa một thông báo gộp/khách/ngày.",
  },
  {
    group: "A. Công nợ phải thu và nhắc thanh toán",
    id: "Q05",
    title: "Kênh gửi và thử lại khi lỗi",
    question:
      "Ưu tiên email hay thông báo trong hệ thống; thử lại bao nhiêu lần?",
    proposal:
      "Khách hàng: email là kênh chính và đồng thời có thông báo trong hệ thống. Nội bộ: thông báo trong hệ thống là kênh chính. Email lỗi thử lại sau 15 phút, 2 giờ và 24 giờ; sau đó báo CUS xử lý.",
  },
  {
    group: "B. Công nợ phải trả, nhiên liệu và nhà cung cấp",
    id: "Q06",
    title: "Hóa đơn nhiên liệu có nhiều xe",
    question:
      "Một hóa đơn có thể gồm nhiều xe không; phân bổ lít và tiền theo căn cứ nào?",
    proposal:
      "Cho phép nhiều xe trên một hóa đơn, phân bổ theo phiếu/nhật ký đổ nhiên liệu thực tế theo biển số, ngày, số lít và đơn giá hóa đơn. Không chia đều; thiếu căn cứ thì giữ chưa phân bổ và chưa duyệt.",
  },
  {
    group: "B. Công nợ phải trả, nhiên liệu và nhà cung cấp",
    id: "Q07",
    title: "Nhà cung cấp có nhiều nhóm dịch vụ",
    question:
      "Một nhà cung cấp có thể thuộc nhiều nhóm không; có cần một nhóm chính để báo cáo?",
    proposal:
      "Cho phép nhiều nhóm, có một nhóm chính làm mặc định và báo cáo tổng hợp; từng hóa đơn/khoản chi vẫn ghi nhóm thực tế.",
  },
  {
    group: "B. Công nợ phải trả, nhiên liệu và nhà cung cấp",
    id: "Q08",
    title: "Đơn vị vừa là khách hàng vừa là nhà cung cấp",
    question:
      "Dùng một hay hai hồ sơ và có được đối trừ công nợ không?",
    proposal:
      "Một hồ sơ đối tác chung theo mã số thuế, gắn hai vai trò; sổ phải thu/phải trả tách riêng. Chỉ đối trừ cùng pháp nhân, cùng loại tiền, có biên bản và phê duyệt; không tự động và không vượt số nhỏ hơn của hai bên.",
  },
  {
    group: "C. Chốt kỳ lương",
    id: "Q09",
    title: "Phạm vi chốt kỳ lương",
    question:
      "Chốt toàn công ty/đơn vị trả lương hay cho phép chốt từng lái xe?",
    proposal:
      "Chốt theo kỳ chung của toàn công ty hoặc đơn vị trả lương cấu hình; không chốt độc lập từng lái xe. Mỗi lái xe có trạng thái Sẵn sàng hoặc Chờ xử lý trước khi chốt.",
  },
  {
    group: "C. Chốt kỳ lương",
    id: "Q10",
    title: "Còn lỗi ở một lái xe khi chốt kỳ",
    question:
      "Chặn toàn kỳ hay cho phép chốt phần còn lại?",
    proposal:
      "Mặc định chặn toàn kỳ nếu lỗi ảnh hưởng số tiền. Chỉ chốt phần còn lại khi người có thẩm quyền phê duyệt loại lái xe đó khỏi kỳ chính; người bị loại chuyển sang Chờ bổ sung và xử lý bằng kỳ bổ sung/điều chỉnh.",
  },
  {
    group: "C. Chốt kỳ lương",
    id: "Q11",
    title: "Thay đổi sau khi chốt",
    question:
      "Mở lại kỳ hay tạo điều chỉnh ở kỳ sau; ai được chốt và mở lại?",
    proposal:
      "Ưu tiên điều chỉnh ở kỳ đang mở. Chỉ mở lại khi chưa phát hành phiếu lương, chưa thanh toán và chưa hạch toán. Kế toán lập, Trưởng phòng Tài chính/Kế toán chốt; Giám đốc hoặc người được ủy quyền mở lại.",
  },
  {
    group: "D. Khoản chi không có hóa đơn",
    id: "Q12",
    title: "Hạng mục và căn cứ thay thế",
    question:
      "Nhóm chi nào được phép không có hóa đơn và bằng chứng nào được chấp nhận?",
    proposal:
      "Danh sách cấu hình gồm bốc xếp/lao động thời vụ, vé bãi/đò/đường hoặc phí nhỏ có phiếu lẻ, xử lý khẩn cấp tại cảng/kho, vật tư nhỏ phục vụ chuyến. Chấp nhận phiếu/biên nhận/vé, chuyển khoản/ví, ảnh có thời gian/địa điểm hoặc xác nhận ký nhận; bắt buộc đủ thông tin cơ bản và ít nhất một bằng chứng.",
  },
  {
    group: "D. Khoản chi không có hóa đơn",
    id: "Q13",
    title: "Ngưỡng khoản chi",
    question:
      "Giới hạn tối đa theo từng khoản và theo người/ngày là bao nhiêu?",
    proposal:
      "Khởi tạo 1.000.000 đồng/khoản và 5.000.000 đồng/người/ngày; cấu hình theo hạng mục và chức danh. Cộng gộp cùng người, ngày và hạng mục để chống chia nhỏ.",
  },
  {
    group: "D. Khoản chi không có hóa đơn",
    id: "Q14",
    title: "Thiếu bằng chứng hoặc vượt ngưỡng",
    question:
      "Tự từ chối hay chuyển duyệt; ai duyệt theo từng mức?",
    proposal:
      "Thiếu bằng chứng tối thiểu thì trả lại để bổ sung. Vượt ngưỡng nhưng đủ căn cứ: Trưởng phòng Tài chính/Kế toán duyệt đến 5.000.000 đồng/khoản; trên mức đó hoặc tổng ngày trên 10.000.000 đồng do Giám đốc duyệt. Không tự duyệt.",
  },
  {
    group: "E. Vai trò, quyền thao tác và phạm vi dữ liệu",
    id: "Q15",
    title: "Tách người tạo, kiểm tra và phê duyệt",
    question:
      "Vai trò nào tạo/kiểm tra/duyệt/chỉ xem và người tạo có được tự duyệt không?",
    proposal:
      "Tách người tạo, kiểm tra và phê duyệt đối với tiền, giá, công nợ, ngoại lệ, chốt kỳ và điều chỉnh. Người tạo không tự duyệt. Cập nhật vận hành thông thường có thể tự lưu; thay đổi tiền hoặc trạng thái đã chốt phải qua kiểm tra và duyệt.",
  },
  {
    group: "E. Vai trò, quyền thao tác và phạm vi dữ liệu",
    id: "Q16",
    title: "Phạm vi tài khoản khách hàng",
    question:
      "Một tài khoản chỉ xem một khách hàng hay có thể xem nhiều pháp nhân?",
    proposal:
      "Mặc định một tài khoản chỉ xem một pháp nhân. Tài khoản tập đoàn/đại lý có thể được quản trị viên liên kết nhiều khách hàng; dữ liệu vẫn tách theo từng pháp nhân. Không cấp quyền dựa riêng trên tên miền email.",
  },
  {
    group: "E. Vai trò, quyền thao tác và phạm vi dữ liệu",
    id: "Q17",
    title: "Phạm vi của Nhân viên chứng từ",
    question:
      "Được tạo/sửa phần nào và giới hạn dữ liệu theo đơn vị, khách hàng hay lô?",
    proposal:
      "Được tạo/sửa hồ sơ lô, vận đơn, công-te-nơ, niêm phong, tờ khai, lệnh giao hàng, điểm nhận/giao và tệp chứng từ. Sau chuyển điều vận chỉ bổ sung dữ liệu không đổi kế hoạch; thay đổi quan trọng tạo phiên bản mới. Phạm vi theo đơn vị và khách hàng/lô được giao; không sửa tiền.",
  },
  {
    group: "E. Vai trò, quyền thao tác và phạm vi dữ liệu",
    id: "Q18",
    title: "Sửa dữ liệu đã duyệt hoặc đã chốt",
    question:
      "Ai được sửa và có bắt buộc lý do/bản điều chỉnh không?",
    proposal:
      "Không sửa trực tiếp. Người có quyền chỉ tạo điều chỉnh/hoàn tác; mở lại là ngoại lệ trước phát hành/hạch toán. Bắt buộc lý do, giá trị trước/sau, người thực hiện và người duyệt. Quản lý xử lý vận hành; Tài chính/Kế toán xử lý tiền; Giám đốc hoặc người được ủy quyền mở kỳ.",
  },
  {
    group: "F. Ngày giờ, kỳ nghiệp vụ và liên kết phân hệ",
    id: "Q19",
    title: "Hạn thanh toán rơi vào ngày nghỉ",
    question:
      "Giữ nguyên hay chuyển sang ngày làm việc tiếp theo?",
    proposal:
      "Chuyển hạn xử lý sang ngày làm việc tiếp theo nhưng vẫn lưu ngày gốc theo hợp đồng. Tính quá hạn và nhắc theo ngày điều chỉnh; nếu hợp đồng quy định ngày lịch thì ưu tiên hợp đồng.",
  },
  {
    group: "F. Ngày giờ, kỳ nghiệp vụ và liên kết phân hệ",
    id: "Q20",
    title: "Chuyến đi qua hai kỳ",
    question:
      "Doanh thu, lương, số chuyến và chi phí thuộc kỳ nào?",
    proposal:
      "Doanh thu, lương chuyến, số chuyến và lợi nhuận vào kỳ của ngày hoàn thành. Chấm công, nhiên liệu và khoản chi theo ngày phát sinh. Chuyến chưa hoàn thành cuối kỳ chưa tính chính thức.",
  },
  {
    group: "F. Ngày giờ, kỳ nghiệp vụ và liên kết phân hệ",
    id: "Q21",
    title: "Cách khóa kỳ và dữ liệu đến muộn",
    question:
      "Khóa theo tuần/tháng/chu kỳ riêng và xử lý dữ liệu phát sinh sau khóa thế nào?",
    proposal:
      "Lương và nhiên liệu khóa theo tháng. Giấy báo nợ theo chu kỳ thanh toán từng khách hàng, mặc định tháng. Dữ liệu đến muộn vào kỳ đang mở dưới dạng điều chỉnh liên kết kỳ gốc; chỉ mở lại trước phát hành/thanh toán và có phê duyệt.",
  },
  {
    group: "F. Ngày giờ, kỳ nghiệp vụ và liên kết phân hệ",
    id: "Q22",
    title: "Nguồn dữ liệu chính và cách tái tính",
    question:
      "Nguồn chính ở từng bước là gì và thay đổi trước/sau chốt được xử lý ra sao?",
    proposal:
      "Lô giữ khách/hàng/công-te-nơ; chuyến giữ xe/lái xe/thời gian/trạng thái; khoản chi đã duyệt giữ chi phí; giấy báo nợ đã phát hành giữ phải thu; tiền về và phân bổ giữ đã thu/còn nợ. Trước chốt tự tính lại; sau chốt tạo phiên bản/điều chỉnh/hoàn tác.",
  },
  {
    group: "F. Ngày giờ, kỳ nghiệp vụ và liên kết phân hệ",
    id: "Q23",
    title: "Gửi hai lần, mạng chập chờn và sửa đồng thời",
    question:
      "Ngăn bản ghi trùng và xử lý xung đột sửa/duyệt theo nguyên tắc nào?",
    proposal:
      "Mỗi thao tác gửi có mã giao dịch duy nhất; gửi lại trả kết quả cũ. Người lưu sau phải tải lại phiên bản mới; phê duyệt hợp lệ đầu tiên khóa trạng thái. Ghi nhật ký mọi lần thử và xung đột.",
  },
];

const extraQuestions = [
  {
    id: "O01",
    title: "Điều động hai chiều: dữ liệu và ngưỡng ghép chuyến",
    priority: "P0 — đang chặn kiểm thử M01-1.7",
    question:
      "Cần chốt dữ liệu bắt buộc và ngưỡng dùng để xác định hai lệnh có thể ghép cho cùng xe/lái xe.",
    proposal:
      "Mỗi lệnh cần thời gian bắt đầu/kết thúc dự kiến, tọa độ hoặc điểm chuẩn nhận/giao, tải trọng hàng và tải trọng xe. SilverSea xác nhận: thời gian đệm tối thiểu; bán kính/địa bàn được xem là nối tiếp; cách tính quãng đường rỗng; xử lý giao trễ, lệnh hủy và chuyến qua ngày; vượt tải là chặn cứng.",
  },
  {
    id: "O02",
    title: "Quyền xem nhật ký thao tác của Kế toán",
    priority: "P1 — cần chốt phạm vi RBAC",
    question:
      "Vai trò Kế toán có được xem nhật ký thao tác hay chỉ ADMIN/MANAGER?",
    proposal:
      "Cho Kế toán xem nhật ký liên quan tiền, công nợ, thanh toán và kỳ lương trong phạm vi được giao; không xem cấu hình bảo mật, thông tin đăng nhập hoặc dữ liệu ngoài phạm vi.",
  },
];

function text(textValue, options = {}) {
  return new TextRun({ text: textValue, font: "Arial", ...options });
}

function para(children, options = {}) {
  const normalizedChildren =
    typeof children === "string"
      ? [text(children)]
      : Array.isArray(children)
        ? children
        : [children];
  return new Paragraph({
    children: normalizedChildren,
    spacing: { after: 100, line: 276 },
    ...options,
  });
}

function fill(color) {
  return { fill: color, type: ShadingType.CLEAR, color: "auto" };
}

function borders(color = COLORS.line, size = 6) {
  return {
    top: { style: BorderStyle.SINGLE, size, color },
    bottom: { style: BorderStyle.SINGLE, size, color },
    left: { style: BorderStyle.SINGLE, size, color },
    right: { style: BorderStyle.SINGLE, size, color },
    insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color },
    insideVertical: { style: BorderStyle.SINGLE, size: 4, color },
  };
}

function cell(children, width, options = {}) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 110, bottom: 110, left: 140, right: 140 },
    children: Array.isArray(children) ? children : [children],
    ...options,
  });
}

function infoTable(rows, widths = [2300, 7000]) {
  return new Table({
    width: { size: 9300, type: WidthType.DXA },
    columnWidths: widths,
    borders: borders(),
    rows: rows.map(([label, value], index) =>
      new TableRow({
        cantSplit: true,
        children: [
          cell(
            para(text(label, { bold: true, color: COLORS.navy, size: 19 }), {
              spacing: { after: 0 },
            }),
            widths[0],
            { shading: fill(index % 2 ? COLORS.pale : COLORS.sky) },
          ),
          cell(
            para(text(value, { size: 19, color: COLORS.black }), {
              spacing: { after: 0 },
            }),
            widths[1],
            { shading: fill(COLORS.white) },
          ),
        ],
      }),
    ),
  });
}

function groupHeading(label) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [text(label, { bold: true, color: COLORS.white, size: 25 })],
    shading: fill(COLORS.blue),
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 10, color: COLORS.navy },
    },
    spacing: { before: 220, after: 160 },
    indent: { left: 140, right: 140 },
    keepNext: true,
  });
}

function questionBlock(q, isExtra = false) {
  const headerText = isExtra
    ? `${q.id}  |  ${q.title}`
    : `${q.id}  |  ${q.title}`;
  const rows = [
    new TableRow({
      cantSplit: true,
      children: [
        cell(
          para(text(headerText, { bold: true, color: COLORS.white, size: 22 }), {
            spacing: { after: 0 },
          }),
          9300,
          {
            columnSpan: 2,
            shading: fill(isExtra ? COLORS.amberText : COLORS.navy),
          },
        ),
      ],
    }),
  ];
  if (q.priority) {
    rows.push(
      new TableRow({
        cantSplit: true,
        children: [
          cell(
            para(text("Mức độ", { bold: true, color: COLORS.amberText, size: 18 }), {
              spacing: { after: 0 },
            }),
            2100,
            { shading: fill(COLORS.amber) },
          ),
          cell(
            para(text(q.priority, { bold: true, color: COLORS.amberText, size: 18 }), {
              spacing: { after: 0 },
            }),
            7200,
            { shading: fill(COLORS.amber) },
          ),
        ],
      }),
    );
  }
  rows.push(
    new TableRow({
      cantSplit: true,
      children: [
        cell(
          para(text("Cần xác nhận", { bold: true, color: COLORS.navy, size: 18 }), {
            spacing: { after: 0 },
          }),
          2100,
          { shading: fill(COLORS.pale) },
        ),
        cell(
          para(text(q.question, { size: 18 }), { spacing: { after: 0 } }),
          7200,
        ),
      ],
    }),
    new TableRow({
      cantSplit: true,
      children: [
        cell(
          para(text("TingTing đề xuất", { bold: true, color: COLORS.navy, size: 18 }), {
            spacing: { after: 0 },
          }),
          2100,
          { shading: fill(COLORS.pale) },
        ),
        cell(
          para(text(q.proposal, { size: 18 }), { spacing: { after: 0 } }),
          7200,
        ),
      ],
    }),
    new TableRow({
      cantSplit: true,
      children: [
        cell(
          para(text("SilverSea trả lời", { bold: true, color: COLORS.greenText, size: 18 }), {
            spacing: { after: 0 },
          }),
          2100,
          { shading: fill(COLORS.green) },
        ),
        cell(
          [
            para(
              [
                text("Chọn:  "),
                text("A. Chấp thuận đề xuất", { bold: true }),
                text("     B. Điều chỉnh như dưới đây"),
              ],
              { spacing: { after: 100 } },
            ),
            para("Ý kiến: ....................................................................................................................", {
              spacing: { after: 40 },
            }),
            para("................................................................................................................................", {
              spacing: { after: 0 },
            }),
          ],
          7200,
          { shading: fill("F8FBF6") },
        ),
      ],
    }),
  );
  return new Table({
    width: { size: 9300, type: WidthType.DXA },
    columnWidths: [2100, 7200],
    borders: borders(),
    rows,
    keepNext: false,
  });
}

function spacer(height = 100) {
  return new Paragraph({ spacing: { after: height }, children: [] });
}

const children = [
  para(
    [
      text("TINGTING", { bold: true, color: COLORS.blue, size: 20 }),
      text("  |  SILVERSEA", { bold: true, color: COLORS.gray, size: 20 }),
    ],
    {
      alignment: AlignmentType.CENTER,
      spacing: { before: 320, after: 420 },
      border: {
        bottom: { style: BorderStyle.SINGLE, size: 14, color: COLORS.blue, space: 8 },
      },
    },
  ),
  para(text("PHIẾU XÁC NHẬN NGHIỆP VỤ", { bold: true, color: COLORS.navy, size: 38 }), {
    alignment: AlignmentType.CENTER,
    spacing: { after: 140 },
  }),
  para(text("Phục vụ nghiệm thu hệ thống vận tải SilverSea", { color: COLORS.blue, size: 25 }), {
    alignment: AlignmentType.CENTER,
    spacing: { after: 440 },
  }),
  infoTable([
    ["Khách hàng", "SilverSea"],
    ["Ngày lập", "27/07/2026"],
    ["Phiên bản", "1.0 — Tổng hợp sau kiểm thử staging"],
    ["Mục đích", "Chốt các quy tắc còn cần thẩm quyền nghiệp vụ trước nghiệm thu"],
  ]),
  spacer(300),
  para(
    text(
      "Tài liệu này chỉ gồm các quyết định mà đội triển khai không thể tự suy đoán. Với mỗi mục, SilverSea vui lòng chọn “Chấp thuận đề xuất” hoặc ghi phương án điều chỉnh. Các ngưỡng tiền, tỷ lệ và lịch gửi sẽ được cấu hình, không mã hóa cứng.",
      { size: 21, color: COLORS.black },
    ),
    {
      shading: fill(COLORS.pale),
      border: {
        left: { style: BorderStyle.SINGLE, size: 18, color: COLORS.blue },
      },
      indent: { left: 220, right: 220 },
      spacing: { before: 120, after: 280 },
    },
  ),
  para(text("Xác nhận đã có", { bold: true, color: COLORS.greenText, size: 24 }), {
    spacing: { before: 100, after: 120 },
  }),
  infoTable(
    [
      [
        "GPS staging",
        "ĐÃ CHỐT — SilverSea cho phép dùng tọa độ GPS mô phỏng trong môi trường staging để kiểm thử luồng theo dõi vị trí.",
      ],
      [
        "Giới hạn",
        "Quyết định này áp dụng cho staging. Kiểm thử thiết bị GPS thật ở môi trường vận hành chỉ thực hiện nếu SilverSea yêu cầu trong tiêu chí nghiệm thu sản xuất.",
      ],
    ],
    [2300, 7000],
  ),
  spacer(360),
  para(text("Ưu tiên phản hồi", { bold: true, color: COLORS.navy, size: 24 }), {
    spacing: { after: 120 },
  }),
  infoTable(
    [
      ["P0", "O01 và Q18: đang chặn kiểm thử đầy đủ điều động hai chiều và sửa chấm công sau chốt."],
      ["P1", "Q01–Q23 còn lại và O02: cần chốt để biến đề xuất thành yêu cầu nghiệm thu chính thức."],
    ],
    [1500, 7800],
  ),
  new Paragraph({ children: [new PageBreak()] }),
  groupHeading("I. Hai quyết định bổ sung phát hiện trong kiểm thử staging"),
  ...extraQuestions.flatMap((q) => [questionBlock(q, true), spacer(180)]),
  new Paragraph({ children: [new PageBreak()] }),
  para(text("II. 23 câu hỏi nghiệp vụ theo PRD", { bold: true, color: COLORS.navy, size: 32 }), {
    spacing: { after: 120 },
  }),
  para(
    text(
      "Toàn bộ Q01–Q23 hiện là đề xuất của TingTing và chưa trở thành yêu cầu đã được SilverSea phê duyệt. Việc xác nhận bằng văn bản sẽ cho phép khóa tiêu chí kiểm thử và triển khai phần còn thiếu.",
      { size: 20 },
    ),
    { spacing: { after: 220 } },
  ),
];

let currentGroup = "";
const pageBreakBeforeQuestion = new Set(["Q18", "Q22"]);
for (const q of qs) {
  if (q.group !== currentGroup) {
    if (currentGroup !== "") {
      children.push(new Paragraph({ children: [new PageBreak()] }));
    }
    currentGroup = q.group;
    children.push(groupHeading(currentGroup));
  }
  if (pageBreakBeforeQuestion.has(q.id)) {
    children.push(new Paragraph({ children: [new PageBreak()] }));
  }
  children.push(questionBlock(q), spacer(160));
}

children.push(
  new Paragraph({ children: [new PageBreak()] }),
  groupHeading("III. Thông tin hỗ trợ nghiệm thu (không phải quyết định nghiệp vụ)"),
  para(
    text(
      "Các nội dung dưới đây không chặn việc dùng GPS mô phỏng trên staging, nhưng sẽ giúp hoàn tất các ca gửi thông báo và kiểm thử thiết bị nếu SilverSea muốn đưa chúng vào biên bản nghiệm thu.",
      { size: 20 },
    ),
    { spacing: { after: 180 } },
  ),
  infoTable([
    [
      "Email nhận thử",
      "Cung cấp một địa chỉ email thử nghiệm an toàn nếu cần xác nhận email nhắc nợ/Thông báo được nhận thực tế.",
    ],
    [
      "Thiết bị thật",
      "Chỉ cần khi tiêu chí nghiệm thu yêu cầu thử camera, quyền thông báo hoặc GPS thật trên điện thoại.",
    ],
    [
      "Mẫu chứng từ",
      "Nếu cần đối chiếu nội dung nghiệp vụ thực tế, cung cấp mẫu đã ẩn dữ liệu nhạy cảm; không gửi mật khẩu hoặc dữ liệu cá nhân trong tài liệu phản hồi.",
    ],
  ]),
  spacer(360),
  groupHeading("IV. Xác nhận của SilverSea"),
  infoTable([
    ["Người xác nhận", "................................................................................................................"],
    ["Chức danh", "................................................................................................................"],
    ["Ngày xác nhận", "........../........../2026"],
    [
      "Phạm vi",
      "Các mục được chọn “Chấp thuận đề xuất” và các điều chỉnh ghi trực tiếp trong tài liệu này.",
    ],
  ]),
  spacer(260),
  para("Chữ ký / xác nhận điện tử:", { spacing: { after: 500 } }),
  para("...................................................................................................................................................."),
  spacer(300),
  para(
    text(
      "Sau khi nhận phản hồi, TingTing sẽ cập nhật trạng thái từng câu hỏi, hoàn thiện các ca kiểm thử phụ thuộc và gửi lại kết quả nghiệm thu có bằng chứng.",
      { italic: true, color: COLORS.gray, size: 19 },
    ),
    {
      alignment: AlignmentType.CENTER,
      border: {
        top: { style: BorderStyle.SINGLE, size: 8, color: COLORS.line, space: 8 },
      },
      spacing: { before: 180, after: 0 },
    },
  ),
);

const doc = new Document({
  creator: "TingTing",
  title: "Phiếu xác nhận nghiệp vụ SilverSea",
  description: "Tổng hợp quyết định nghiệp vụ còn chờ SilverSea xác nhận sau kiểm thử staging",
  styles: {
    default: {
      document: {
        run: { font: "Arial", size: 20, color: COLORS.black },
        paragraph: { spacing: { after: 100, line: 276 } },
      },
      heading1: {
        run: { font: "Arial", size: 26, bold: true, color: COLORS.navy },
        paragraph: { spacing: { before: 220, after: 140 }, keepNext: true },
      },
    },
  },
  numbering: {
    config: [
      {
        reference: "customer-items",
        levels: [
          {
            level: 0,
            format: LevelFormat.DECIMAL,
            text: "%1.",
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: { indent: { left: 540, hanging: 280 } },
              run: { font: "Arial" },
            },
          },
        ],
      },
    ],
  },
  sections: [
    {
      properties: {
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 900, right: 900, bottom: 900, left: 900, header: 420, footer: 420 },
        },
      },
      headers: {
        default: new Header({
          children: [
            para(
              [
                text("SILVERSEA  |  XÁC NHẬN NGHIỆP VỤ", {
                  bold: true,
                  color: COLORS.blue,
                  size: 16,
                }),
                text("\tTài liệu làm việc", { color: COLORS.gray, size: 16 }),
              ],
              {
                tabStops: [{ type: "right", position: 9300 }],
                border: {
                  bottom: { style: BorderStyle.SINGLE, size: 6, color: COLORS.line },
                },
                spacing: { after: 0 },
              },
            ),
          ],
        }),
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                text("TingTing • 27/07/2026  |  Trang ", { color: COLORS.gray, size: 16 }),
                new TextRun({ children: [PageNumber.CURRENT], font: "Arial", color: COLORS.gray, size: 16 }),
                text("/", { color: COLORS.gray, size: 16 }),
                new TextRun({ children: [PageNumber.TOTAL_PAGES], font: "Arial", color: COLORS.gray, size: 16 }),
              ],
            }),
          ],
        }),
      },
      children,
    },
  ],
});

Packer.toBuffer(doc).then((buffer) => {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, buffer);
  process.stdout.write(`${outputPath}\n`);
});
