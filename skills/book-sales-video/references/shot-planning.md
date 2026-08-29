# 整组镜头规划

`storyboard.json` 决定每个视觉段表达什么；`shot-plan.json` 决定整组画面如何被观看。正文图片必须先完成整组镜头规划，再逐张生成。

## 规划顺序

1. 把全部正文视觉段一次性列出，不边生成边决定下一张。
2. 为整组设定视觉节奏：建立空间、靠近人物、观察细节、拉开距离、进入转折、完成收束。
3. 为每段分配展示形式、景别、视角和构图；先检查相邻差异，再写生图提示词。
4. 为整组先确定一个正文字幕方案，再让每张图为同一字幕框保留真实可用区域。
5. 运行 `validate_shot_plan.py`。错误清零后才进入正文生图。
6. 生成后将全部缩略图并排检查，验证实际结果而不是只相信计划字段。

## 展示形式

在整组中按内容交替使用：

- `character-action`：人物正在做一个具体动作。
- `environment`：用空间关系和人物尺度建立处境。
- `object-detail`：手、手机、花、门把、书页等物件或动作细节。
- `pov`：人物主观视角或视线方向。
- `over-shoulder`：从人物肩后观察目标或出口。
- `conceptual-tableau`：人物与单一概念装置形成完整场面。
- `empty-space`：没有人物或人物很小，用空房间、空椅、走廊等承接情绪。

不连续使用相同展示形式。尤其避免连续人物背影、连续侧脸肖像或连续“一个人坐着”的画面。

## 景别与视角

`shotScale` 使用：

- `extreme-close-up`
- `close-up`
- `medium-close-up`
- `medium-shot`
- `full-shot`
- `wide-shot`
- `extreme-wide-shot`

`cameraView` 使用清楚的组合描述，例如：

- `eye-level-front`
- `eye-level-profile`
- `high-angle`
- `low-angle`
- `top-down`
- `bird-eye`
- `over-shoulder`
- `first-person-pov`
- `through-glass`
- `foreground-obstructed`

相邻两张必须同时满足：

- `shotScale` 不同。
- `cameraView` 不同。

只改变焦段措辞、人物动作、背景或左右方向，不算满足视角变化。

六张及以上的序列至少包含四种景别和四种视角。避免简单按“远—中—近—远—中—近”机械循环；镜头变化要服务叙事。

## 构图差异

同时规划：

- `composition`：对称、偏置、上下留白、框中框、前景遮挡、对角线、负形等；正文场景必须横向满幅，不能设计左右留白。
- `subjectPlacement`：左、右、上、下、中心、远处小比例等。
- `paperBlankRatio`：默认“粗纸油画画外留白”风格使用 `0.20`–`0.30`，优先为 `0.20`–`0.25`；只计算未上色纸面，不计算场景中的墙、天空或浅色背景。
- `paperBlankPlacement`：未上色纸面只允许 `top`、`bottom` 或 `top-and-bottom`；禁止 `left`、`right`、角落和对角线。
- `paintedScenePlacement`：固定为 `full-width`；油画场景在左右方向触达画幅边缘，只能通过上下边缘的位置、人物位置、景别、视角和边缘形态形成变化。
- `paintedEdgeTreatment`：`dry-brush-fade`、`broken-edge`、`scumbled-edge` 或 `open-contour`。
- `foreground`：是否通过门框、玻璃、家具、人物肩部或物件建立层次。
- `captionLane`：整组字幕所处的固定轨道，例如 `paper-lower`。
- `captionBox`：字幕框的明确像素区域，包含 `left`、`top`、`width`、`height`；不能只写“下方留白”。
- `captionSurface`：字幕框下方的真实画面类型，默认必须为 `unpainted-paper`。
- `captionContrastMode`：固定为 `white-black-stroke`；中英文均为白字黑描边，原生字幕和 Motion Graphic 路线不得改变这一视觉规则。
- `contrastWithPrevious`：明确写出这张与前一张在尺度、视角、主体或空间上的差异。

不连续使用居中人物、相同主体位置、相同姿势或相同房间构图。默认风格下也不要连续使用相同的上下留白比例或边缘形态；画外留白必须是未上色粗纸，不能只有名义上的场景留白，且不得出现在左右边缘。

原生 captions overlay 使用全局布局，因此默认整组的 `captionLane`、`captionBox` 和 `captionContrastMode` 必须一致。每张图可以改变油画场景内部构图、上下纸面比例和边缘形态，但不能侵占统一字幕框，也不能把油画场景缩离左右画幅边缘。若确实需要逐镜换位或换明暗样式，在顶层把 `captionPlan.implementation` 改为 `motion-graphic` 并明确每张卡的路线，不得假装原生字幕支持逐页布局。

## `shot-plan.json` 最小结构

```json
{
  "canvas": {"width": 1080, "height": 1920},
  "sequenceIntent": "从被困住到重新获得选择",
  "styleId": "rough-paper-oil-vignette-v3",
  "captionPlan": {
    "implementation": "native-bilingual",
    "lane": "paper-lower",
    "surface": "unpainted-paper",
    "contrastMode": "white-black-stroke",
    "box": {"left": 120, "top": 1250, "width": 800, "height": 240}
  },
  "shots": [
    {
      "id": "shot-01",
      "storyboardSegmentId": "body-01",
      "narrativeFunction": "建立人物被空间压住的处境",
      "visualForm": "environment",
      "subject": "主要人物",
      "action": "独自等待",
      "shotScale": "extreme-wide-shot",
      "cameraView": "high-angle",
      "composition": "油画场景横向满幅，人物在场景内偏右，下方留纸承载字幕",
      "subjectPlacement": "right-lower-small",
      "paperBlankRatio": 0.24,
      "paperBlankPlacement": "bottom",
      "paintedScenePlacement": "full-width",
      "paintedEdgeTreatment": "dry-brush-fade",
      "foreground": "none",
      "captionLane": "paper-lower",
      "captionSurface": "unpainted-paper",
      "captionContrastMode": "white-black-stroke",
      "captionBox": {"left": 120, "top": 1250, "width": 800, "height": 240},
      "continuityAnchor": "同一人物、服装和强调色",
      "contrastWithPrevious": "first-shot"
    }
  ]
}
```

## 生成后复查

- 把全部正文图以相同尺寸并排查看。
- 对照计划确认实际景别和视角；模型生成结果与提示词不一致时，以画面为准。
- 若相邻两张实际仍相似，只重新生成偏离计划的一张，不推翻已经合格的整组。
- 检查多样性时不牺牲人物身份、色彩、材质和世界观连续性。
- 默认风格还要对照实际成图检查未上色纸面比例、上下留白位置、左右满幅和边缘处理；模型用空墙冒充留白、在左右或角落留纸、把场景缩成小块或纵向铺满时，只重生成偏离计划的图片。
- 把统一字幕框叠在全部缩略图上复查。任一画面侵占字幕框、背景纹理过密或对比不足时，先重生成该图，不把字幕临时挪到另一个位置。
