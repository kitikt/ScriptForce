function normalizeScript(originalScript) {
  return typeof originalScript === 'string' ? originalScript : '';
}

const RANDOM_NAME_RULE = `QUY TẮC TÊN NHÂN VẬT BẮT BUỘC:
Đổi tên toàn bộ dàn nhân vật chính và phụ. Không được dùng các tên Clara, Eleanor, Elanor, Ruth, Ellie ở bất kỳ đâu trong bản mới.
Luôn random tên nhân vật ngẫu nhiên cho mỗi câu chuyện bằng cách tự tạo một seed từ bối cảnh, năm xảy ra câu chuyện, nghề nghiệp nhân vật chính và xung đột trung tâm.
Tên phải là tên Anh Mỹ hợp lý với bối cảnh Hoa Kỳ, không dùng tên Latin nổi bật, không dùng tên Trung Quốc, Hán, Việt Nam hoặc tên nghe không phù hợp văn hóa Mỹ.
Ưu tiên tên Mỹ ít phổ biến nhưng vẫn tự nhiên, dễ đọc, phù hợp tuổi, giới tính, vùng miền và thời kỳ.
Sau khi đã random ở dàn ý, các phần sau phải giữ nhất quán toàn bộ tên đó, trừ bước sửa cuối nếu được yêu cầu đổi lại toàn bộ.`;

const STEPS = [
  {
    stepNumber: 1,
    name: 'Phân tích kịch bản gốc',
    buildPrompt(originalScript) {
      return `Bạn hãy phân tích ngắn gọn video dưới đây và đánh giá tiềm năng phát triển thành video viral 1,5 tiếng:

Tóm tắt bằng tiếng Việt: Tóm tắt cốt truyện và nhân vật chính (240 từ).

Phân tích điểm mạnh và điểm yếu:
3 yếu tố mạnh nhất
2 điểm cần cải thiện hoặc phát triển

Cấu trúc 3 phần:
Đề xuất cách chia video thành 3 phần:
Phần 1: Giới thiệu nhân vật và xung đột
Phần 2: Phát triển vấn đề và thử thách
Phần 3: Giải quyết và kết thúc
Xác định hook và twist tiềm năng cho mỗi phần.

Đánh giá thang điểm 10:
Tiềm năng viral
Sức hấp dẫn nhân vật
Cường độ xung đột
Khả năng mở rộng

Kết luận với đề xuất hướng phát triển chính cho video 1,5 tiếng.

Kịch bản gốc:
${normalizeScript(originalScript)}`;
    },
  },
  {
    stepNumber: 2,
    name: 'Viết outline 3 phần',
    buildPrompt() {
      return `Bạn phải chỉnh sửa những điểm yếu trong khi vẫn giữ nguyên những điểm mạnh của câu chuyện gốc, trung thành với cốt truyện chính.

Sau đó, hãy viết cho tôi một dàn ý gồm 3 phần cho câu chuyện này, tổng độ dài kịch bản cuối cùng từ 16.000 đến 17.000 từ, với các yêu cầu cụ thể sau:

Cấu trúc dàn ý:
Phần 1: Giới thiệu nhân vật và xung đột
Phần 2: Phát triển vấn đề và thử thách
Phần 3: Giải quyết và kết thúc

Mỗi phần nên dài khoảng 5.000 đến 5.700 từ. Không chia nhỏ thành các chương.

Yêu cầu nội dung:
Bao gồm 8 bước ngoặt lớn (major twists)
5 cao trào (climaxes)
8 đến 10 điểm móc câu (hooks, các chi tiết thu hút người đọc tiếp tục đọc)
Giữ nguyên độ tuổi, giới tính và các đặc điểm nhận dạng chính của nhân vật, nhưng phải đổi tên nhân vật.
Tên nhân vật phải là tên Anh Mỹ, không được tên Latin.
Đảm bảo tính hợp lý của các sự kiện, tên nhân vật, tính cách, quá khứ, tuổi tác và giới tính.
Bối cảnh phải đặt tại Hoa Kỳ, không được có yếu tố Việt Nam.
Vẫn tuân thủ theo cốt truyện chính gốc, mở rộng sâu hơn nếu cần.
Không được mâu thuẫn với các sự kiện chính của câu chuyện gốc.
Mỗi phần phải có ít nhất 2 xung đột giữa người với người, không chỉ xung đột người với thiên nhiên hoặc người với hoàn cảnh.
Thêm ít nhất 3 nhân vật phụ có vai trò rõ ràng gây trở ngại hoặc hỗ trợ nhân vật chính, tạo tương tác cảm xúc.

${RANDOM_NAME_RULE}

QUY TẮC CHỐNG LẶP BẮT BUỘC CHO DÀN Ý:
Mỗi thông tin khoa học, kỹ thuật, hoặc giải thích cơ chế chỉ được xuất hiện TỐI ĐA 1 LẦN trong toàn bộ kịch bản.
Nếu cần nhắc lại ở phần sau, phải thông qua hành động nhân vật hoặc tình huống mới, KHÔNG được giải thích lại bằng lời kể.

Tỉ lệ bắt buộc:
Tối thiểu 70% nội dung là câu chuyện nhân vật: hành động, cảm xúc, xung đột, đối thoại.
Tối đa 30% là giải thích hoặc mô tả kỹ thuật.

Không so sánh cùng một cặp đối tượng quá 2 lần trong toàn bộ kịch bản.

Dàn ý phải liệt kê rõ:
Sự kiện nào là MỚI, được thêm vào.
Sự kiện nào là GỐC, từ câu chuyện gốc.

Đánh giá dàn ý cuối cùng trên thang điểm từ 1 đến 10.

Không bao giờ được tạo file. Chỉ trả lời trong chat.`;
    },
  },
  {
    stepNumber: 3,
    name: 'Đánh giá và cải thiện outline',
    buildPrompt() {
      return `Đánh giá dàn ý theo 6 tiêu chí riêng biệt, mỗi tiêu chí thang 10:

Mật độ sự kiện:
Có đủ sự kiện mới để lấp đầy 16.000 đến 17.000 từ mà không cần lặp lại bất kỳ thông tin nào không?

Đa dạng xung đột:
Có xung đột giữa người với người, không chỉ người với thiên nhiên không?

Tiến triển cảm xúc:
Nhân vật chính có thay đổi cảm xúc rõ ràng qua từng phần không?

Không lặp lại:
Có điểm nào trong dàn ý mà khi viết thành văn sẽ bị lặp ý không? Nếu có, chỉ rõ và sửa ngay.

Hook retention:
Cứ mỗi 1.500 đến 2.000 từ có ít nhất 1 hook hoặc twist không?

Phù hợp đối tượng:
Nam 60+ ở Mỹ, emotionally engaged viewers.

NẾU BẤT KỲ tiêu chí nào DƯỚI 9 ĐIỂM, phải viết lại dàn ý mới hay hơn, phù hợp với cấu trúc và yêu cầu về storytelling cho Nam giới tuổi 60+ ở Mỹ.

Lưu ý:
Nếu là dạng kể hồi ức tuổi trẻ thì giới hạn số năm là những năm 1920 đổ lại về trước.
Còn nếu không phải dạng kể hồi ức thì tuổi của nhân vật chính chỉ xê dịch từ 1 đến 2 tuổi.
Không tự ý tăng tuổi nhân vật quá nhiều.
Bám sát các sự kiện chính của chuyện gốc.
Dàn ý viết toàn bộ bằng tiếng Việt, chỉ có tên nhân vật và địa danh thì giữ nguyên tiếng Anh để tôi có thể đọc hiểu.

${RANDOM_NAME_RULE}

Không bao giờ được tạo file. Chỉ trả lời trong chat.`;
    },
  },
  {
    stepNumber: 4,
    name: 'Viết Part 1',
    buildPrompt() {
      return `DỰA VÀO DÀN Ý CHI TIẾT VIẾT PHẦN 1, ĐỘ DÀI 5.000 ĐẾN 5.500 TỪ BẰNG TIẾNG ANH.
ĐẢM BẢO ĐẦY ĐỦ TWIST, ĐẢM BẢO ĐỦ THÔNG TIN TRONG DÀN Ý.

Chú ý:
KHÔNG sử dụng BẤT KỲ DẤU GẠCH NÀO TRONG BÀI.
Trả kết quả thường, không phải txt.
Không tạo file, chỉ trả lời trong chat.
Lưu ý cân đối nội dung để cả kịch bản có tổng độ dài từ 16.000 đến 17.000 từ.

${RANDOM_NAME_RULE}
Ở bước này, dùng đúng bộ tên đã được random và chốt trong dàn ý gần nhất. Không đổi tên tùy tiện giữa các phần.

QUY TẮC CHỐNG LẶP KHI VIẾT:
Mỗi khái niệm khoa học hoặc kỹ thuật chỉ được giải thích CHI TIẾT 1 lần duy nhất trong toàn bộ kịch bản.
Những lần sau nếu cần nhắc, chỉ dùng tối đa 1 câu ngắn hoặc thể hiện qua hành động nhân vật.
Không so sánh cùng một cặp đối tượng quá 2 lần trong toàn bộ kịch bản.
Nếu một đoạn văn không đưa câu chuyện tiến về phía trước, không có sự kiện mới, cảm xúc mới, hoặc xung đột mới, hãy xóa đoạn đó.
Tỉ lệ: 70% câu chuyện nhân vật, 30% mô tả và giải thích.

Tone & Style Requirements:
Cinematic prose: focus on visual storytelling and emotional intensity.
Rhythmic pacing: optimized for speech, text to speech.
Limited dialogue, but each line must have emotional impact.
Designed for high YouTube viewer retention.
Target audience: Male, over 60, living in the US, emotionally engaged viewers.
Do not write "_____" in the end of each part.`;
    },
  },
  {
    stepNumber: 5,
    name: 'Viết Part 2',
    buildPrompt() {
      return `DỰA VÀO DÀN Ý CHI TIẾT VÀ PHẦN 1 ĐÃ VIẾT, VIẾT PHẦN 2 ĐỘ DÀI 5.000 ĐẾN 5.700 TỪ BẰNG TIẾNG ANH.
ĐẢM BẢO ĐẦY ĐỦ TWIST VÀ CLIMAX THEO DÀN Ý.

Chú ý:
KHÔNG sử dụng BẤT KỲ DẤU GẠCH NÀO TRONG BÀI.
Trả kết quả thường, không phải txt.
Không được tạo file, chỉ trả lời trong chat.

${RANDOM_NAME_RULE}
Ở bước này, giữ đúng bộ tên đã dùng trong Phần 1. Không tự đổi tên nhân vật.

QUY TẮC CHỐNG LẶP:
Trước khi viết, hãy liệt kê tất cả các khái niệm và so sánh đã xuất hiện trong Phần 1.
KHÔNG được giải thích lại bất kỳ khái niệm nào trong danh sách đó.
Chỉ được nhắc qua hành động hoặc đối thoại ngắn tối đa 1 câu.
KHÔNG lặp lại bất kỳ so sánh nào đã dùng trong Phần 1.
Mỗi đoạn văn phải chứa ít nhất 1 trong 3 yếu tố: sự kiện mới, cảm xúc mới, hoặc xung đột mới. Nếu không có thì XÓA.
Tỉ lệ: 70% câu chuyện nhân vật, 30% mô tả và giải thích.
Phần 2 phải mở đầu bằng một hook mạnh và kết thúc bằng một cliffhanger hoặc twist để người xem muốn tiếp tục.

Tone & Style Requirements:
Cinematic prose: focus on visual storytelling and emotional intensity.
Rhythmic pacing: optimized for speech, text to speech.
Limited dialogue, but each line must have emotional impact.
Designed for high YouTube viewer retention.
Target audience: Male, over 60, living in the US, emotionally engaged viewers.
Do not write "_____" in the end of each part.`;
    },
  },
  {
    stepNumber: 6,
    name: 'Viết Part 3',
    buildPrompt() {
      return `DỰA VÀO DÀN Ý CHI TIẾT VÀ PHẦN 1, PHẦN 2 ĐÃ VIẾT, VIẾT PHẦN 3 ĐỘ DÀI 5.000 ĐẾN 5.700 TỪ BẰNG TIẾNG ANH.
ĐẢM BẢO ĐẦY ĐỦ TWIST VÀ CLIMAX CUỐI CÙNG THEO DÀN Ý.
ĐẢM BẢO KẾT THÚC HOÀN THIỆN, THỎA MÃN NGƯỜI XEM.

Chú ý:
KHÔNG sử dụng BẤT KỲ DẤU GẠCH NÀO TRONG BÀI.
Trả kết quả thường, không phải txt.
Không được tạo file, chỉ trả lời trong chat.

${RANDOM_NAME_RULE}
Ở bước này, giữ đúng bộ tên đã dùng trong Phần 1 và Phần 2. Không tự đổi tên nhân vật.

QUY TẮC CHỐNG LẶP:
Trước khi viết, hãy liệt kê tất cả các khái niệm và so sánh đã xuất hiện trong Phần 1 và Phần 2.
KHÔNG được giải thích lại bất kỳ khái niệm nào trong danh sách đó.
KHÔNG lặp lại bất kỳ so sánh nào đã dùng trong Phần 1 hoặc Phần 2.
Mỗi đoạn văn phải chứa ít nhất 1 trong 3 yếu tố: sự kiện mới, cảm xúc mới, hoặc xung đột mới.
Tỉ lệ: 70% câu chuyện nhân vật, 30% mô tả và giải thích.
Phần 3 phải có kết thúc hoàn thiện, không bỏ lửng. Người xem phải cảm thấy thỏa mãn và xúc động khi kết thúc.

Tone & Style Requirements:
Giữ nguyên như Phần 1 và Phần 2.
Do not write "_____" in the end of each part.`;
    },
  },
  {
    stepNumber: 7,
    name: 'Bước 7a: Ghép và kiểm tra',
    buildPrompt() {
      return `BƯỚC 7A: GHÉP VÀ KIỂM TRA

Ghép cả 3 phần đã viết, Phần 1, Phần 2, Phần 3, lại thành kịch bản hoàn chỉnh.

YÊU CẦU TẠO FILE TXT:
Hãy tạo một TXT artifact chứa TOÀN BỘ kịch bản đã ghép.
Tên artifact nên là "complete_screenplay_draft.txt".
Trong artifact TXT chỉ đặt kịch bản hoàn chỉnh, không đặt phần phân tích, không đặt checklist, không đặt lời giải thích.

Sau khi tạo TXT artifact, đọc lại toàn bộ kịch bản và kiểm tra theo các tiêu chí sau.
Phần kiểm tra chất lượng chỉ trả lời trong chat, KHÔNG tạo file mới cho phần kiểm tra.

Logic:
Truyện có logic không? Có sạn to nào không?

Nhất quán nhân vật:
Tên, giới tính, tuổi, tính cách, nền tảng có đồng nhất xuyên suốt không?

Thời gian:
Có lỗi thời gian lẫn lộn không? Các mốc thời gian có khớp nhau không?

Lặp khái niệm:
Có khái niệm nào được giải thích hơn 1 lần không?
Liệt kê từng cái, chỉ rõ vị trí: đoạn nào, câu mở đầu của đoạn đó.

Lặp so sánh:
Có cặp so sánh nào xuất hiện hơn 2 lần không? Liệt kê.

Đoạn chết:
Có đoạn nào không đưa câu chuyện tiến về phía trước không? Liệt kê.

Tỉ lệ:
Ước tính số từ dành cho giải thích kỹ thuật vs câu chuyện nhân vật.
Nếu giải thích vượt 30%, chỉ rõ đoạn nào cần cắt.

Twist và climax:
Đã bám sát outline đủ số twist và climax chưa?
Liệt kê từng twist và climax đã xuất hiện.

Kết thúc:
Có hoàn thiện và thỏa mãn người xem không?

Đánh giá tổng thể trên thang 10 điểm.

CẤM BỊA LỖI.
Chỉ báo lỗi có thật.
Với mỗi lỗi, CHỈ RÕ:
Vị trí chính xác, trích dẫn câu mở đầu của đoạn có lỗi.
Mô tả lỗi.
Cách sửa cụ thể.

${RANDOM_NAME_RULE}
Không đổi tên trong bước kiểm tra nếu kịch bản đã nhất quán và không dùng tên bị cấm. Nếu phát hiện tên bị cấm, phải ghi rõ là lỗi cần sửa ở bước 7B.`;
    },
  },
  {
    stepNumber: 8,
    name: 'Bước 7b: Sửa và tạo file hoàn chỉnh',
    buildPrompt() {
      return `BƯỚC 7B: SỬA VÀ TẠO FILE HOÀN CHỈNH

NẾU bước trên đánh giá DƯỚI 9.5 ĐIỂM:
Dựa vào danh sách lỗi ở bước trên, hãy sửa TẤT CẢ các lỗi đã liệt kê.
Sau đó viết lại kịch bản đã sửa hoàn chỉnh và TẠO FILE TXT MỚI.
Tên artifact nên là "final_corrected_screenplay.txt".
Trong artifact TXT chỉ đặt kịch bản hoàn chỉnh đã sửa, không đặt checklist, không đặt phân tích, không đặt lời giải thích.

Sau khi tạo file, xác nhận ngắn gọn trong chat:
Đã sửa những lỗi nào.
Sửa ở đâu.
Tên file TXT đã tạo là gì.

NẾU bước trên đánh giá TỪ 9.5 ĐIỂM TRỞ LÊN:
Không cần viết lại toàn bộ nếu không có lỗi thật.
Chỉ xác nhận ngắn gọn trong chat rằng kịch bản đạt yêu cầu.
Nếu kịch bản vẫn còn tên bị cấm hoặc tên không phù hợp văn hóa Mỹ, vẫn phải sửa và tạo TXT mới dù điểm số trên 9.5.

${RANDOM_NAME_RULE}
Ở bước này, nếu cần sửa tên, phải đổi tên toàn bộ dàn nhân vật trong toàn bộ kịch bản một cách nhất quán.
Không được dùng Clara, Eleanor, Elanor, Ruth, Ellie ở bất kỳ đâu.
Không dùng tên Trung Quốc, Hán, Việt Nam hoặc tên nghe sai văn hóa Mỹ.
Tên phải nghe như người Mỹ thật, ít phổ biến nhưng hợp lý với tuổi, giới tính, vùng miền và thời kỳ.
Không bịa lỗi mới. Chỉ sửa lỗi thật đã được phát hiện hoặc lỗi tên bị cấm.`;
    },
  },
];

module.exports = STEPS;
module.exports.STEPS = STEPS;
