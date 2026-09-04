# 6. Danh mục model và bảng giá credit

Nguồn: `modelConfig` trong `GET /fx/api/trpc/flow.projectInitialData`.
File này được sinh tự động từ dữ liệu bắt được (`_ctl/gen_pricing_doc.py`),
không gõ tay.

Tổng: **82 usage key** đang hiệu lực (5 ảnh, 77 video) và **53 model key đã deprecated**.

## 6.1 Cách đọc bảng

- Cột ENTRY / INTERMEDIATE / ADVANCED là chi phí credit theo `serviceTier` của
  tài khoản (đọc từ `GET /v1/credits`). `n/a` = `UNAVAILABLE`, không dùng được
  ở tier đó.
- `len` là độ dài video (giây). `gen` là thời gian sinh ước tính (giây).
- `AR` là aspect ratio cho phép: L = LANDSCAPE, P = PORTRAIT.
- `usage key` là giá trị truyền vào `videoModelKey` (video) hoặc
  `imageModelName` (ảnh).

## 6.2 Mặc định theo tier

| serviceTier | Họ model ảnh | Họ model video |
|-------------|--------------|----------------|
| `SERVICE_TIER_ENTRY` | `narwhal_display` | `abra` |
| `SERVICE_TIER_INTERMEDIATE` | `narwhal_display` | `abra` |
| `SERVICE_TIER_ADVANCED` | `narwhal_display` | `abra` |

Model âm thanh dùng chung: `gemini_v4s_tts_flow`.

## 6.3 Các họ model

| Tên hiển thị | familyId | Loại | Số usage key |
|--------------|----------|------|--------------|
| 🍌 Nano Banana Pro | `nano_banana_pro` | image | 1 |
| 🍌 Nano Banana 2 | `narwhal_display` | image | 1 |
| 🍌 Nano Banana 2 Lite | `harbor_seal` | image | 1 |
| 2K | `upsample_2k` | image | 1 |
| 4k | `upsample_4k` | image | 1 |
| Omni Flash | `abra` | video | 13 |
| Veo 3.1 - Lite | `veo_3_1_lite` | video | 11 |
| Veo 3.1 - Fast | `veo_3_1_fast` | video | 26 |
| Veo 3.1 - Quality | `veo_3_1_quality` | video | 14 |
| Veo 3.1 - Lite [Lower Priority] | `veo_3_1_lite_low_priority` | video | 11 |
| Veo 3.1 - Upsampler 1080P | `veo_3_1_upsampler_1080p` | video | 1 |
| Veo 3.1 - Upsampler 4K | `veo_3_1_upsampler_4k` | video | 1 |

## 6.4 Model ảnh

| usage key | familyId | ENTRY | INTERMEDIATE | ADVANCED | gen | AR | maxRefs |
|-----------|----------|-------|--------------|----------|-----|----|---------|
| `GEM_PIX_2` | `nano_banana_pro` | 0 | 0 | 0 | 40 | 1:1/P/L/3:4/4:3 | 10 |
| `NARWHAL` | `narwhal_display` | 0 | 0 | 0 | 30 | 1:1/P/L/3:4/4:3 | 10 |
| `HARBOR_SEAL` | `harbor_seal` | 0 | 0 | 0 | 40 | 1:1/P/L/3:4/4:3 | 10 |
| `GEM_PIX_2_UPSAMPLE_2K` | `upsample_2k` | 0 | 0 | 0 | 20 | 1:1/P/L/3:4/4:3 | 0 |
| `GEM_PIX_2_UPSAMPLE_4K` | `upsample_4k` | n/a | n/a | 0 | 30 | 1:1/P/L/3:4/4:3 | 0 |

## 6.5 Model video

### Omni Flash (`abra`)

| usage key | Chế độ | ENTRY | INTERMEDIATE | ADVANCED | len | gen | AR | audio | maxImgIn |
|-----------|--------|-------|--------------|----------|-----|-----|----|-------|----------|
| `abra_t2v_4s` | text-to-video | 7 | 7 | 7 | 4 | 120 | L/P | có | 0 |
| `abra_t2v_6s` | text-to-video | 10 | 10 | 10 | 6 | 120 | L/P | có | 0 |
| `abra_t2v_8s` | text-to-video | 12 | 12 | 12 | 8 | 120 | L/P | có | 0 |
| `abra_t2v_10s` | text-to-video | 15 | 15 | 15 | 10 | 120 | L/P | có | 0 |
| `abra_r2v_4s` | reference-to-video | 7 | 7 | 7 | 4 | 120 | L/P | có | 7 |
| `abra_r2v_6s` | reference-to-video | 10 | 10 | 10 | 6 | 120 | L/P | có | 7 |
| `abra_r2v_8s` | reference-to-video | 12 | 12 | 12 | 8 | 120 | L/P | có | 7 |
| `abra_r2v_10s` | reference-to-video | 15 | 15 | 15 | 10 | 120 | L/P | có | 7 |
| `abra_edit` | edit | 20 | 20 | 20 | - | 160 | L/P | có | 5 |
| `abra_i2v_4s` | image-to-video | 7 | 7 | 7 | 4 | 120 | L/P | có | 0 |
| `abra_i2v_6s` | image-to-video | 10 | 10 | 10 | 6 | 120 | L/P | có | 0 |
| `abra_i2v_8s` | image-to-video | 12 | 12 | 12 | 8 | 120 | L/P | có | 0 |
| `abra_i2v_10s` | image-to-video | 15 | 15 | 15 | 10 | 120 | L/P | có | 0 |

Độ phân giải hỗ trợ: `VIDEO_RESOLUTION_720P`, `VIDEO_RESOLUTION_360P`.

### Veo 3.1 - Lite (`veo_3_1_lite`)

| usage key | Chế độ | ENTRY | INTERMEDIATE | ADVANCED | len | gen | AR | audio | maxImgIn |
|-----------|--------|-------|--------------|----------|-----|-----|----|-------|----------|
| `veo_3_1_t2v_lite` | text-to-video | 10 | 10 | 5 | 8 | 110 | L/P | có | 0 |
| `veo_3_1_i2v_lite` | image-to-video | 10 | 10 | 5 | 8 | 110 | L/P | có | 0 |
| `veo_3_1_r2v_lite` | reference-to-video | 10 | 10 | 5 | 8 | 110 | L/P | có | 3 |
| `veo_3_1_interpolation_lite` | start+end image | 10 | 10 | 5 | 8 | 110 | L/P | có | 0 |
| `veo_3_1_extension_lite` | extend | 10 | 10 | 5 | 8 | 110 | L/P | có | 0 |
| `veo_3_1_t2v_lite_4s` | text-to-video | n/a | n/a | 5 | 4 | 110 | L/P | có | 0 |
| `veo_3_1_i2v_s_lite_4s` | image-to-video | n/a | n/a | 5 | 4 | 110 | L/P | có | 0 |
| `veo_3_1_i2v_s_lite_4s_fl` | start+end image | n/a | n/a | 5 | 4 | 110 | L/P | có | 0 |
| `veo_3_1_t2v_lite_6s` | text-to-video | n/a | n/a | 5 | 6 | 110 | L/P | có | 0 |
| `veo_3_1_i2v_s_lite_6s` | image-to-video | n/a | n/a | 5 | 6 | 110 | L/P | có | 0 |
| `veo_3_1_i2v_s_lite_6s_fl` | start+end image | n/a | n/a | 5 | 6 | 110 | L/P | có | 0 |

### Veo 3.1 - Fast (`veo_3_1_fast`)

| usage key | Chế độ | ENTRY | INTERMEDIATE | ADVANCED | len | gen | AR | audio | maxImgIn |
|-----------|--------|-------|--------------|----------|-----|-----|----|-------|----------|
| `veo_3_1_t2v_fast` | text-to-video | 20 | 20 | n/a | 8 | 100 | L | có | 0 |
| `veo_3_1_t2v_fast_ultra` | text-to-video | n/a | n/a | 10 | 8 | 100 | L | có | 0 |
| `veo_3_1_t2v_fast_portrait` | text-to-video | 20 | 20 | n/a | 8 | 100 | P | có | 0 |
| `veo_3_1_t2v_fast_portrait_ultra` | text-to-video | n/a | n/a | 10 | 8 | 100 | P | có | 0 |
| `veo_3_1_r2v_fast_landscape` | reference-to-video | 20 | 20 | n/a | 8 | 100 | L | có | 3 |
| `veo_3_1_r2v_fast_landscape_ultra` | reference-to-video | n/a | n/a | 10 | 8 | 100 | L | có | 3 |
| `veo_3_1_r2v_fast_portrait` | reference-to-video | 20 | 20 | n/a | 8 | 100 | P | có | 3 |
| `veo_3_1_r2v_fast_portrait_ultra` | reference-to-video | n/a | n/a | 10 | 8 | 100 | P | có | 3 |
| `veo_3_1_i2v_s_fast` | image-to-video | 20 | 20 | n/a | 8 | 180 | L | có | 0 |
| `veo_3_1_i2v_s_fast_ultra` | image-to-video | n/a | n/a | 10 | 8 | 180 | L | có | 0 |
| `veo_3_1_i2v_s_fast_portrait` | image-to-video | 20 | 20 | n/a | 8 | 180 | P | có | 0 |
| `veo_3_1_i2v_s_fast_portrait_ultra` | image-to-video | n/a | n/a | 10 | 8 | 180 | P | có | 0 |
| `veo_3_1_i2v_s_fast_fl` | start+end image | 20 | 20 | n/a | 8 | 180 | L | có | 0 |
| `veo_3_1_i2v_s_fast_ultra_fl` | start+end image | n/a | n/a | 10 | 8 | 180 | L | có | 0 |
| `veo_3_1_i2v_s_fast_portrait_fl` | start+end image | 20 | 20 | n/a | 8 | 180 | P | có | 0 |
| `veo_3_1_i2v_s_fast_portrait_ultra_fl` | start+end image | n/a | n/a | 10 | 8 | 180 | P | có | 0 |
| `veo_3_1_extend_fast_landscape` | extend | 20 | 20 | n/a | 8 | 330 | L | có | 0 |
| `veo_3_1_extend_fast_landscape_ultra` | extend | n/a | n/a | 10 | 8 | 330 | L | có | 0 |
| `veo_3_1_extend_fast_portrait` | extend | 20 | 20 | n/a | 8 | 330 | P | có | 0 |
| `veo_3_1_extend_fast_portrait_ultra` | extend | n/a | n/a | 10 | 8 | 330 | P | có | 0 |
| `veo_3_1_t2v_fast_4s` | text-to-video | n/a | n/a | 10 | 4 | 110 | L/P | có | 0 |
| `veo_3_1_i2v_s_fast_4s` | image-to-video | n/a | n/a | 10 | 4 | 110 | L/P | có | 0 |
| `veo_3_1_i2v_s_fast_4s_fl` | start+end image | n/a | n/a | 10 | 4 | 110 | L/P | có | 0 |
| `veo_3_1_t2v_fast_6s` | text-to-video | n/a | n/a | 10 | 6 | 160 | L/P | có | 0 |
| `veo_3_1_i2v_s_fast_6s` | image-to-video | n/a | n/a | 10 | 6 | 160 | L/P | có | 0 |
| `veo_3_1_i2v_s_fast_6s_fl` | start+end image | n/a | n/a | 10 | 6 | 160 | L/P | có | 0 |

### Veo 3.1 - Quality (`veo_3_1_quality`)

| usage key | Chế độ | ENTRY | INTERMEDIATE | ADVANCED | len | gen | AR | audio | maxImgIn |
|-----------|--------|-------|--------------|----------|-----|-----|----|-------|----------|
| `veo_3_1_t2v_portrait` | text-to-video | 100 | 100 | 100 | 8 | 120 | P | có | 0 |
| `veo_3_1_t2v` | text-to-video | 100 | 100 | 100 | 8 | 120 | L | có | 0 |
| `veo_3_1_i2v_s_portrait` | image-to-video | 100 | 100 | 100 | 8 | 120 | P | có | 0 |
| `veo_3_1_i2v_s` | image-to-video | 100 | 100 | 100 | 8 | 120 | L | có | 0 |
| `veo_3_1_i2v_s_fl` | start+end image | 100 | 100 | 100 | 8 | 120 | L | có | 0 |
| `veo_3_1_i2v_s_portrait_fl` | start+end image | 100 | 100 | 100 | 8 | 120 | P | có | 0 |
| `veo_3_1_extend_landscape` | extend | 100 | 100 | 100 | 8 | 270 | L | có | 0 |
| `veo_3_1_extend_portrait` | extend | 100 | 100 | 100 | 8 | 270 | P | có | 0 |
| `veo_3_1_t2v_quality_4s` | text-to-video | n/a | n/a | 100 | 4 | 210 | L/P | có | 0 |
| `veo_3_1_i2v_s_quality_4s` | image-to-video | n/a | n/a | 100 | 4 | 210 | L/P | có | 0 |
| `veo_3_1_i2v_s_quality_4s_fl` | start+end image | n/a | n/a | 100 | 4 | 210 | L/P | có | 0 |
| `veo_3_1_t2v_quality_6s` | text-to-video | n/a | n/a | 100 | 6 | 260 | L/P | có | 0 |
| `veo_3_1_i2v_s_quality_6s` | image-to-video | n/a | n/a | 100 | 6 | 260 | L/P | có | 0 |
| `veo_3_1_i2v_s_quality_6s_fl` | start+end image | n/a | n/a | 100 | 6 | 260 | L/P | có | 0 |

### Veo 3.1 - Lite [Lower Priority] (`veo_3_1_lite_low_priority`)

| usage key | Chế độ | ENTRY | INTERMEDIATE | ADVANCED | len | gen | AR | audio | maxImgIn |
|-----------|--------|-------|--------------|----------|-----|-----|----|-------|----------|
| `veo_3_1_t2v_lite_low_priority` | text-to-video | n/a | n/a | 0 | 8 | 110 | L/P | có | 0 |
| `veo_3_1_i2v_lite_low_priority` | image-to-video | n/a | n/a | 0 | 8 | 110 | L/P | có | 0 |
| `veo_3_1_r2v_lite_low_priority` | reference-to-video | n/a | n/a | 0 | 8 | 110 | L/P | có | 3 |
| `veo_3_1_interpolation_lite_low_priority` | start+end image | n/a | n/a | 0 | 8 | 110 | L/P | có | 0 |
| `veo_3_1_extension_lite_low_priority` | extend | n/a | n/a | 0 | 8 | 110 | L/P | có | 0 |
| `veo_3_1_t2v_lite_4s_low_priority` | text-to-video | n/a | n/a | 0 | 4 | 110 | L/P | có | 0 |
| `veo_3_1_i2v_s_lite_4s_low_priority` | image-to-video | n/a | n/a | 0 | 4 | 110 | L/P | có | 0 |
| `veo_3_1_i2v_s_lite_4s_fl_low_priority` | start+end image | n/a | n/a | 0 | 4 | 110 | L/P | có | 0 |
| `veo_3_1_t2v_lite_6s_low_priority` | text-to-video | n/a | n/a | 0 | 6 | 110 | L/P | có | 0 |
| `veo_3_1_i2v_s_lite_6s_low_priority` | image-to-video | n/a | n/a | 0 | 6 | 110 | L/P | có | 0 |
| `veo_3_1_i2v_s_lite_6s_fl_low_priority` | start+end image | n/a | n/a | 0 | 6 | 110 | L/P | có | 0 |

### Veo 3.1 - Upsampler 1080P (`veo_3_1_upsampler_1080p`)

| usage key | Chế độ | ENTRY | INTERMEDIATE | ADVANCED | len | gen | AR | audio | maxImgIn |
|-----------|--------|-------|--------------|----------|-----|-----|----|-------|----------|
| `veo_3_1_upsampler_1080p` | upsample | n/a | 0 | 0 | 60 | 330 | L/P | có | 0 |

### Veo 3.1 - Upsampler 4K (`veo_3_1_upsampler_4k`)

| usage key | Chế độ | ENTRY | INTERMEDIATE | ADVANCED | len | gen | AR | audio | maxImgIn |
|-----------|--------|-------|--------------|----------|-----|-----|----|-------|----------|
| `veo_3_1_upsampler_4k` | upsample | n/a | n/a | 50 | 60 | 330 | L/P | có | 0 |

## 6.6 Giới hạn input theo model

| usage key | maxCharacters | maxAudioRefs | maxInputV2vDuration | requirements |
|-----------|---------------|--------------|---------------------|--------------|
| `GEM_PIX_2` | 10 | - | - | TEXT ; TEXT+BASE_IMAGE ; TEXT+REFERENCES ; TEXT+REFERENCES+BASE_IMAGE ; TEXT+REFERENCES+CHARACTERS ; TEXT+REFERENCES+CHARACTERS+BASE_IMAGE |
| `GEM_PIX_2_UPSAMPLE_2K` | - | - | - | UPSAMPLE_IMAGE_RESOLUTION2K |
| `GEM_PIX_2_UPSAMPLE_4K` | - | - | - | UPSAMPLE_IMAGE_RESOLUTION4K |
| `abra_t2v_4s` | - | - | - | TEXT |
| `abra_r2v_4s` | 3 | 5 | - | TEXT+REFERENCES ; TEXT+REFERENCES+AUDIO_REFERENCE+CHARACTERS ; TEXT+REFERENCES+AUDIO_REFERENCE |
| `abra_edit` | 3 | 3 | 10 | TEXT+REFERENCES+AUDIO_REFERENCE+CHARACTERS+VIDEO_EDIT |
| `abra_i2v_4s` | - | - | - | TEXT+START_IMAGE |
| `veo_3_1_r2v_lite` | 3 | 1 | - | TEXT+REFERENCES ; TEXT+REFERENCES+AUDIO_REFERENCE+CHARACTERS ; TEXT+REFERENCES+AUDIO_REFERENCE |
| `veo_3_1_interpolation_lite` | - | - | - | TEXT+START_IMAGE+END_IMAGE |
| `veo_3_1_extension_lite` | - | - | 8 | TEXT+EXTENSION |
| `veo_3_1_upsampler_1080p` | - | - | - | UPSAMPLE1080 |
| `veo_3_1_upsampler_4k` | - | - | - | UPSAMPLE4K |

Các usage key không liệt kê ở đây dùng chung một tổ hợp input với một dòng phía
trên (bảng chỉ giữ các tổ hợp khác nhau).

## 6.7 Model key đã deprecated

53 key dưới đây còn xuất hiện trong `deprecatedModelKeys`. Không dùng
cho tích hợp mới; chúng chỉ để đọc lại media cũ.

```text
GEM_PIX  veo_2_0_i2v
veo_2_0_object_insertion_landscape  veo_2_0_object_insertion_portrait
veo_2_0_object_removal_landscape  veo_2_0_object_removal_portrait
veo_2_0_t2v  veo_2_1080p_upsampler_8s
veo_2_1_fast_d_15_i2v  veo_2_1_fast_d_15_t2v
veo_2_1_fast_d_15_with_start_image_and_end_image_interpolation  veo_2_1_fast_d_15_with_video_extension
veo_2_camera_control  veo_2_r2v
veo_2_r2v_fast  veo_3_0_r2v_fast
veo_3_0_r2v_fast_ultra  veo_3_0_r2v_fast_ultra_relaxed
veo_3_0_reshoot_landscape  veo_3_0_reshoot_portrait
veo_3_0_t2v  veo_3_0_t2v_fast
veo_3_0_t2v_fast_portrait_ultra  veo_3_0_t2v_fast_ultra
veo_3_0_t2v_portrait  veo_3_1_extend_fast_4s_relaxed
veo_3_1_extend_fast_6s_relaxed  veo_3_1_extend_fast_landscape_ultra_relaxed
veo_3_1_extend_fast_portrait_ultra_relaxed  veo_3_1_fast_low_priority
veo_3_1_i2v_s_fast_4s_fl_relaxed  veo_3_1_i2v_s_fast_4s_relaxed
veo_3_1_i2v_s_fast_6s_fl_relaxed  veo_3_1_i2v_s_fast_6s_relaxed
veo_3_1_i2v_s_fast_fl_ultra_relaxed  veo_3_1_i2v_s_fast_portrait_fl_ultra_relaxed
veo_3_1_i2v_s_fast_portrait_ultra_relaxed  veo_3_1_i2v_s_fast_ultra_relaxed
veo_3_1_r2v_fast_landscape_ultra_relaxed  veo_3_1_r2v_fast_portrait_ultra_relaxed
veo_3_1_t2v_fast_4s_relaxed  veo_3_1_t2v_fast_6s_relaxed
veo_3_1_t2v_fast_portrait_ultra_relaxed  veo_3_1_t2v_fast_ultra_relaxed
veo_3_i2v_s  veo_3_i2v_s_fast
veo_3_i2v_s_fast_portrait_ultra  veo_3_i2v_s_fast_portrait_ultra_fl
veo_3_i2v_s_fast_ultra  veo_3_i2v_s_fast_ultra_fl
veo_3_i2v_s_fl  veo_3_i2v_s_portrait
veo_3_i2v_s_portrait_fl
```
