'use client'

import type { PlatType } from '@/app/config/platConfig'
import { Loader2, Sparkles } from 'lucide-react'
import Image from 'next/image'
import { useMemo, useState } from 'react'
import { AccountPlatInfoMap } from '@/app/config/platConfig'
import { aiChatStream } from '@/api/ai'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/lib/toast'

interface PlatformCopyResult {
  platform: string
  title: string
  description: string
  hashtags: string[]
  cta: string
}

// 去掉 Qwen 等模型在 JSON 前的 think 思考块，避免整段无法 JSON.parse
function stripModelReasoningPrefix(content: string): string {
  let s = content.trim()
  const splitRe = new RegExp('<' + 'think>\\s*', 'i')
  const parts = s.split(splitRe)
  if (parts.length > 1)
    s = parts[parts.length - 1] ?? s
  const stripRe = new RegExp('^\\s*<' + 'think>[\\s\\S]*?</' + 'think>\\s*', 'i')
  s = s.replace(stripRe, '')
  return s.trim()
}

/** 从混有说明文字的字符串里取出第一个完整 JSON 对象 */
function extractFirstJsonObject(text: string): string | null {
  const anchored = text.search(/\{\s*"results"\s*:/)
  const start = anchored !== -1 ? anchored : text.indexOf('{')
  if (start === -1)
    return null
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (escape) {
      escape = false
      continue
    }
    if (inString && c === '\\') {
      escape = true
      continue
    }
    if (c === '"' && !escape) {
      inString = !inString
      continue
    }
    if (inString)
      continue
    if (c === '{')
      depth++
    else if (c === '}')
      depth--
    if (depth === 0)
      return text.slice(start, i + 1)
  }
  return null
}

function parseJsonFromContent(content: string): PlatformCopyResult[] {
  let body = stripModelReasoningPrefix(content)
  const fenceMatch = body.match(/```json\s*([\s\S]*?)\s*```/i) || body.match(/```\s*([\s\S]*?)\s*```/i)
  body = (fenceMatch?.[1] || body).trim()

  let parsed: { results?: unknown } | unknown[] | null = null
  try {
    parsed = JSON.parse(body) as any
  }
  catch {
    const extracted = extractFirstJsonObject(body) || extractFirstJsonObject(content)
    if (!extracted)
      return []
    try {
      parsed = JSON.parse(extracted) as any
    }
    catch {
      return []
    }
  }

  const items = Array.isArray(parsed) ? parsed : (parsed as { results?: unknown })?.results
  if (!Array.isArray(items))
    return []

  return items
    .map((item: any) => ({
      platform: String(item.platform || ''),
      title: String(item.title || ''),
      description: String(item.description || ''),
      hashtags: Array.isArray(item.hashtags) ? item.hashtags.map((h: any) => String(h)) : [],
      cta: String(item.cta || ''),
    }))
    .filter((item: PlatformCopyResult) => item.platform && item.description)
}

export function CopyStudioPageContent() {
  const [productName, setProductName] = useState('')
  const [sellingPoints, setSellingPoints] = useState('')
  const [targetAudience, setTargetAudience] = useState('')
  const [tone, setTone] = useState('专业、可信、带轻微种草感')
  const [extraRequirements, setExtraRequirements] = useState('')
  const [copyLanguage, setCopyLanguage] = useState('zh-CN')
  const [isGenerating, setIsGenerating] = useState(false)
  const [results, setResults] = useState<PlatformCopyResult[]>([])

  const LANGUAGE_OPTIONS = [
    { value: 'zh-CN', label: '中文（简体）' },
    { value: 'zh-TW', label: '中文（繁體）' },
    { value: 'en', label: 'English' },
    { value: 'ja', label: '日本語' },
    { value: 'ko', label: '한국어' },
    { value: 'es', label: 'Español' },
    { value: 'fr', label: 'Français' },
    { value: 'de', label: 'Deutsch' },
    { value: 'pt', label: 'Português' },
    { value: 'ru', label: 'Русский' },
    { value: 'ar', label: 'العربية' },
    { value: 'th', label: 'ภาษาไทย' },
    { value: 'vi', label: 'Tiếng Việt' },
    { value: 'id', label: 'Bahasa Indonesia' },
    { value: 'ms', label: 'Bahasa Melayu' },
  ]

  const getLanguageLabel = (value: string) =>
    LANGUAGE_OPTIONS.find(l => l.value === value)?.label || value

  const platformOptions = useMemo(
    () =>
      Array.from(AccountPlatInfoMap.entries()).map(([key, info]) => ({
        key,
        label: info.name,
        icon: info.icon,
        limits: info.commonPubParamsConfig,
      })),
    [],
  )
  const [selectedPlatforms, setSelectedPlatforms] = useState<PlatType[]>([platformOptions[0]?.key as PlatType].filter(Boolean))
  const isAllSelected = platformOptions.length > 0 && selectedPlatforms.length === platformOptions.length

  const getPlatformLabel = (platform: string) => {
    const normalized = platform.trim().toLowerCase()
    const matched = platformOptions.find(item => item.key.toLowerCase() === normalized)
    return matched?.label || platform
  }

  const togglePlatform = (platform: PlatType) => {
    setSelectedPlatforms((prev) => {
      if (prev.includes(platform))
        return prev.filter(p => p !== platform)
      return [...prev, platform]
    })
  }

  const handleToggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedPlatforms([])
      return
    }
    setSelectedPlatforms(platformOptions.map(item => item.key))
  }

  const PLATFORM_SYSTEM_PROMPTS_ZH: Record<string, string> = {
    xhs: `你是一名资深小红书爆款文案专家。你的文案风格：
- 标题：必须有强吸引力的钩子，善用数字、emoji、反问句，控制在20字内
- 正文：采用"个人体验分享"的种草笔记风格，用第一人称，多分段，适当加 emoji 增强阅读感
- 语气亲切、真实、有生活感，像在跟闺蜜/好友分享好物
- 善用"绝绝子""真的会谢""姐妹们冲"等小红书社区语言
- 正文字数 300-800 字，内容要有信息密度
- 话题标签 3-5 个，选热门且精准的`,
    douyin: `你是一名抖音爆款短视频文案专家。你的文案风格：
- 标题：必须在前5个字抓住注意力，善用悬念、反转、数字冲击
- 正文：适合做视频口播或字幕的节奏感文案，短句为主，每句话都要有冲击力
- 善用"你知道吗""别再...了""90%的人不知道"等抖音爆款句式
- 要有强烈的情绪驱动和行动号召
- 正文字数 200-500 字
- 话题标签 5-10 个，含行业热门标签`,
    KWAI: `你是一名快手平台内容专家。你的文案风格：
- 快手用户偏好真实、接地气、实用的内容
- 语气直接朴实，不用花哨辞藻，像老友推荐
- 善用"老铁""家人们""真心推荐"等快手社区用语
- 正文简洁有力，200-400 字，突出性价比和实用性
- 话题标签 3-4 个，选接地气的标签`,
    bilibili: `你是一名B站内容文案专家。你的文案风格：
- 标题：信息量大、有专业感，可以用【】做前缀分类标签
- 正文：详细、有深度、逻辑清晰，适合做视频简介
- 语气专业但不刻板，可以适当幽默，融入B站社区文化
- 善用分段、序号列表来组织信息
- 正文字数 500-1500 字，强调干货和技术细节
- 话题标签 5-10 个，含专业垂类标签`,
    tiktok: `你是一名 TikTok 爆款内容文案专家。你的文案风格：
- TikTok 无标题，聚焦正文/描述区（caption）
- 第一句话必须是强钩子——用好奇心缺口、大胆声明或戳痛点来抓住注意力
- 短句为主，节奏快，能量高，有感染力
- 语气轻松、口语化，像在跟朋友聊天
- 明确的行动号召（关注、收藏、分享、评论）
- 正文字数 200-500 字
- 3-5 个热门+垂类话题标签`,
    youtube: `你是一名 YouTube SEO 与视频描述文案专家。你的文案风格：
- 标题：高搜索友好度，包含核心关键词，善用数字或强力词，不超过 100 字
- 描述：详细且 SEO 友好，500-1000 字
  - 前 2 行必须是吸引人的钩子（这是折叠前可见内容）
  - 包含内容摘要、核心要点、时间戳占位
  - 加上订阅、点赞、评论的行动号召
- 话题标签：3-5 个相关标签（YouTube 会在标题上方显示前 3 个）
- 用搜索思维：用户会搜什么关键词来找到这个视频？`,
    twitter: `你是一名 Twitter/X 病毒传播推文文案专家。你的文案风格：
- 无标题，正文就是推文本体（严格不超过 280 字——这是硬限制！）
- 每个字都要精打细算——犀利、有洞察、一针见血
- 善用以下爆款格式：犀利观点、连推钩子、反问句、大胆声明、微型故事
- 可以建议一个后续连推的开头
- 话题标签最多 1-3 个（Twitter 会惩罚标签堆砌）
- 行动号召要自然融入，不要硬推销`,
    facebook: `你是一名 Facebook 社群互动文案专家。你的文案风格：
- 无标题，正文即帖子内容
- 用温暖的故事型语气——Facebook 奖励有深度的互动
- 结构：钩子 → 故事/价值 → 提问或行动号召来带动评论
- 长帖（300-600 字）如果讲了一个好故事，表现会很好
- 多用换行增强可读性
- 3-5 个话题标签，混合大众标签和垂类标签
- 行动号召要引导分享或 @ 好友`,
    instagram: `你是一名 Instagram 内容与配文专家。你的文案风格：
- 标题：短小精悍，适合 Reels 封面文字
- 配文：视觉叙事风格，200-500 字
  - 第一行是钩子（折叠前可见，"...更多"之前的内容）
  - 个人声音与干货价值结合——教育、启发或娱乐
  - 结尾用互动提问来带动评论
- 话题标签：10-20 个，混合大标签（100万+）、中标签（10万-100万）和小标签（<10万）
- 语气：有质感、有向往感、精致生活调性`,
    threads: `你是一名 Threads 内容文案专家。你的文案风格：
- Threads 是文字优先、对话式、社群驱动的平台
- 像在发起一场轻松但有洞察力的对话
- 中短篇幅（150-400 字），好读易懂
- 犀利观点、个人看法、"反共识观点"等格式效果好
- 话题标签极简（1-3 个），保持干净
- 行动号召：邀请回复和讨论`,
    pinterest: `你是一名 Pinterest 搜索优化与图钉描述专家。你的文案风格：
- 标题：极简短（不超过 16 字！），关键词密集，行动导向
- 描述：搜索优化导向，200-400 字
  - 为 Pinterest 搜索引擎而写——自然融入关键词
  - 灵感型、向往型的语气
  - 结构：这是什么 → 为什么值得关注 → 怎么使用/获取
- 话题标签：5-10 个相关的、关键词导向的标签
- 核心思维："值得收藏"——用户收藏 Pin 是为了以后参考`,
    linkedin: `你是一名 LinkedIn 思想领袖内容专家。你的文案风格：
- 标题：专业感强、有洞察力，让作者显得像行业专家
- 正文：300-500 字，专业但有温度
  - 开头用一个大胆洞察、惊人数据或反常识观点抓住注意
  - 短段落（每段 1-2 句），适配手机阅读
  - 分享一个经验教训、方法论框架或行业观察
  - 结尾用一个引人深思的问题
- 话题标签：3-5 个行业垂类标签
- 语气：权威但不高高在上，专业但不冷冰冰，绝不做推销`,
  }

  const PLATFORM_SYSTEM_PROMPTS_EN: Record<string, string> = {
    xhs: `You are a Xiaohongshu (RedNote) viral copywriting expert. Your style:
- Title: Must have a strong hook, use numbers, emoji, rhetorical questions, max 20 characters
- Body: Personal experience sharing style, first person, well-segmented, use emoji for readability
- Tone: warm, authentic, relatable — like sharing a great find with a close friend
- Body length: 300-800 characters, content-rich
- 3-5 hashtags, trending and precise`,
    douyin: `You are a Douyin (Chinese TikTok) viral short-video copywriting expert. Your style:
- Title: First 5 characters must grab attention — use suspense, reversal, number shock
- Body: Rhythm-driven copy for voiceover or subtitles, short punchy sentences
- Strong emotional drive and clear CTA
- Body length: 200-500 characters
- 5-10 hashtags including industry trending tags`,
    KWAI: `You are a Kuaishou (Kwai) content expert. Your style:
- Down-to-earth, authentic, practical content
- Direct, plain language — like a friend's honest recommendation
- Body: concise and punchy, 200-400 characters, emphasize value and practicality
- 3-4 relatable hashtags`,
    bilibili: `You are a Bilibili content copywriting expert. Your style:
- Title: information-rich, professional feel, can use bracket prefixes for categories
- Body: detailed, in-depth, logically structured — suitable for video descriptions
- Professional but not rigid, slightly humorous, aligned with Bilibili community culture
- Use paragraphs and numbered lists to organize information
- Body length: 500-1500 characters, emphasize substance and technical detail
- 5-10 hashtags including vertical niche tags`,
    tiktok: `You are a TikTok viral content copywriting expert. Your style:
- No title needed; focus on the caption/description
- First line must be a strong hook — curiosity gap, bold claim, or relatable pain point
- Short punchy sentences, fast rhythm, high energy, infectious
- Casual, conversational tone — like chatting with a friend
- Clear CTA (follow, save, share, comment)
- Description: 200-500 characters
- 3-5 trending + niche hashtags`,
    youtube: `You are a YouTube SEO and video description expert. Your style:
- Title: highly searchable, include primary keyword, use numbers or power words, max 100 chars
- Description: detailed and SEO-friendly, 500-1000 characters
  - First 2 lines must hook the viewer (visible before "Show more")
  - Include content summary, key takeaways, timestamp placeholders
  - Add subscribe, like, comment CTA
- 3-5 relevant hashtags (YouTube shows top 3 above title)
- Think like a search engine: what would someone type to find this?`,
    twitter: `You are a Twitter/X viral tweet copywriting expert. Your style:
- No title; the description IS the tweet (strict max 280 chars!)
- Every word counts — sharp, insightful, razor-precise
- Use proven formats: hot take, thread hook, rhetorical question, bold statement, micro-story
- Optionally suggest a follow-up thread hook
- Max 1-3 hashtags (Twitter penalizes hashtag spam)
- CTA should feel organic, not salesy`,
    facebook: `You are a Facebook community engagement copywriting expert. Your style:
- No title; description is the post body
- Warm storytelling tone — Facebook rewards meaningful engagement
- Structure: hook → story/value → question or CTA to drive comments
- Longer posts (300-600 characters) perform well with good storytelling
- Use line breaks for readability
- 3-5 hashtags, mix of broad and niche
- CTA should invite sharing or tagging friends`,
    instagram: `You are an Instagram content and caption expert. Your style:
- Title: short and catchy, suitable for Reels cover text
- Caption: visual-storytelling style, 200-500 characters
  - First line is the hook (visible before "...more")
  - Mix personal voice with value — educate, inspire, or entertain
  - End with an engagement question to drive comments
- 10-20 hashtags: mix of large (1M+), medium (100K-1M), and small (<100K) tags
- Tone: polished, aspirational, lifestyle-oriented`,
    threads: `You are a Threads content expert. Your style:
- Threads is text-first, conversational, and community-driven
- Write like starting a casual but insightful conversation
- Short to medium length (150-400 characters), easy to read
- Hot takes, opinions, and contrarian views perform well
- Minimal hashtags (1-3), keep it clean
- CTA: invite replies and discussion`,
    pinterest: `You are a Pinterest SEO and pin description expert. Your style:
- Title: ultra-concise (max 16 chars!), keyword-rich, action-oriented
- Description: search-optimized, 200-400 characters
  - Write for Pinterest's search engine — weave in keywords naturally
  - Inspirational, aspirational tone
  - Structure: what it is → why it matters → how to use/get it
- 5-10 relevant, keyword-focused hashtags
- Core mindset: "save-worthy" — users pin for future reference`,
    linkedin: `You are a LinkedIn thought leadership content expert. Your style:
- Title: professional, insight-driven, positions the author as an industry expert
- Body: 300-500 characters, professional yet personable
  - Open with a bold insight, surprising stat, or contrarian take
  - Short paragraphs (1-2 sentences each) for mobile readability
  - Share a lesson, framework, or industry observation
  - End with a thought-provoking question
- 3-5 industry-specific hashtags
- Tone: authoritative yet approachable, professional but not cold, never salesy`,
  }

  const buildUserPrompt = (platformKey: string, platformLabel: string, limits: { titleMax?: number, desMax: number, topicMax: number }) => {
    const langLabel = getLanguageLabel(copyLanguage)
    const isChinese = copyLanguage === 'zh-CN' || copyLanguage === 'zh-TW'

    if (isChinese) {
      return `请根据以下产品信息，为 ${platformLabel} 平台生成一条高质量推广文案。

【输出语言】
${langLabel}

【产品名称】
${productName}

【核心卖点】
${sellingPoints}

【目标受众】
${targetAudience || '未指定'}

【语气风格】
${tone}

【额外要求】
${extraRequirements || '无'}

【字数限制】
${limits.titleMax ? `标题不超过 ${limits.titleMax} 字` : '无标题要求'}
正文不超过 ${limits.desMax} 字
话题标签不超过 ${limits.topicMax} 个

请只返回 JSON（不要输出任何解释），格式如下：
{
  "platform": "${platformKey}",
  "title": "标题（如果该平台无标题则留空字符串）",
  "description": "正文",
  "hashtags": ["话题1", "话题2"],
  "cta": "行动号召"
}`
    }

    return `Generate a high-quality promotional copy for the ${platformLabel} platform based on the product info below.

## CRITICAL LANGUAGE RULE
- The output language is: ${langLabel}
- ALL output text (title, description, hashtags, CTA) MUST be written 100% in ${langLabel}.
- The product info below may be written in Chinese or another language. You MUST translate and localize ALL of it into ${langLabel}. Do NOT copy any Chinese characters or words from the input into the output.
- Every single character in your JSON values must be in ${langLabel}. Zero exceptions.

[Product Name (translate to ${langLabel})]
${productName}

[Key Selling Points (translate to ${langLabel})]
${sellingPoints}

[Target Audience]
${targetAudience || 'Not specified'}

[Tone & Style]
${tone}

[Additional Requirements]
${extraRequirements || 'None'}

[Length Limits]
${limits.titleMax ? `Title: max ${limits.titleMax} characters` : 'No title required'}
Description: max ${limits.desMax} characters
Hashtags: max ${limits.topicMax} tags

Return ONLY JSON (no explanations), in this format:
{
  "platform": "${platformKey}",
  "title": "title in ${langLabel} (empty string if platform has no title)",
  "description": "body text in ${langLabel}",
  "hashtags": ["tag1 in ${langLabel}", "tag2 in ${langLabel}"],
  "cta": "call to action in ${langLabel}"
}`
  }

  const handleGenerate = async () => {
    if (!productName.trim() || !sellingPoints.trim()) {
      toast.warning('请先填写产品名称和核心卖点')
      return
    }
    if (selectedPlatforms.length === 0) {
      toast.warning('请至少选择一个平台')
      return
    }

    setIsGenerating(true)
    setResults([])
    try {
      const copyStudioModel = process.env.NEXT_PUBLIC_COPY_STUDIO_CHAT_MODEL || 'Qwen3-30B-A3B-AWQ'
      const maxOut = Number(process.env.NEXT_PUBLIC_COPY_STUDIO_MAX_TOKENS || '12000')
      const maxTokens = Number.isFinite(maxOut) && maxOut > 0 ? maxOut : 12000

      const selected = platformOptions.filter(item => selectedPlatforms.includes(item.key))

      const langLabel = getLanguageLabel(copyLanguage)
      const isChinese = copyLanguage === 'zh-CN' || copyLanguage === 'zh-TW'
      const promptMap = isChinese ? PLATFORM_SYSTEM_PROMPTS_ZH : PLATFORM_SYSTEM_PROMPTS_EN
      const defaultPrompt = isChinese
        ? '你是一个专业的社交媒体文案专家，擅长为不同平台撰写高转化文案。'
        : 'You are a professional social media copywriting expert, skilled at writing high-conversion copy for different platforms.'

      const tasks = selected.map(async (item) => {
        const systemPrompt = promptMap[item.key] || defaultPrompt

        const langInstruction = isChinese
          ? `\n\n语言要求：所有文案内容（标题、正文、话题标签、行动号召）必须使用${langLabel}撰写。`
          : `\n\n[LANGUAGE REQUIREMENT — CRITICAL]\nYou MUST write ALL output content (title, description, hashtags, CTA) entirely in ${langLabel}.\nThe user input below is in Chinese — treat it as source material. TRANSLATE and LOCALIZE all concepts, brand names, and terms into natural ${langLabel}. NEVER copy any Chinese characters into your output. Every single character in every JSON string value must be in ${langLabel}.`
        const outputInstruction = isChinese
          ? '输出要求：只返回合法 JSON，不要输出思考过程，不要输出 markdown 代码块以外的说明。'
          : `Output: Return ONLY valid JSON. No thinking, no markdown fences, no explanations. All text values must be in ${langLabel}.`

        const response = await aiChatStream({
          model: copyStudioModel,
          messages: [
            {
              role: 'system',
              content: `${systemPrompt}${langInstruction}\n\n${outputInstruction}`,
            },
            { role: 'user', content: buildUserPrompt(item.key, item.label, item.limits) },
          ],
          temperature: 0.8,
          maxTokens,
        })

        const data = await response.json()
        if (data?.code !== 0 || !data?.data?.content)
          return null

        const content = stripModelReasoningPrefix(data.data.content)
        const fenceMatch = content.match(/```json\s*([\s\S]*?)\s*```/i) || content.match(/```\s*([\s\S]*?)\s*```/i)
        const jsonStr = (fenceMatch?.[1] || content).trim()

        try {
          const obj = JSON.parse(jsonStr)
          return {
            platform: String(obj.platform || item.key),
            title: String(obj.title || ''),
            description: String(obj.description || ''),
            hashtags: Array.isArray(obj.hashtags) ? obj.hashtags.map((h: any) => String(h)) : [],
            cta: String(obj.cta || ''),
          } as PlatformCopyResult
        }
        catch {
          const extracted = extractFirstJsonObject(jsonStr) || extractFirstJsonObject(content)
          if (!extracted) return null
          try {
            const obj = JSON.parse(extracted)
            return {
              platform: String(obj.platform || item.key),
              title: String(obj.title || ''),
              description: String(obj.description || ''),
              hashtags: Array.isArray(obj.hashtags) ? obj.hashtags.map((h: any) => String(h)) : [],
              cta: String(obj.cta || ''),
            } as PlatformCopyResult
          }
          catch { return null }
        }
      })

      const settled = await Promise.allSettled(tasks)
      const parsed = settled
        .map(r => r.status === 'fulfilled' ? r.value : null)
        .filter((item): item is PlatformCopyResult => item !== null && !!item.description)

      if (parsed.length === 0) {
        throw new Error('所有平台均生成失败，请稍后重试')
      }
      setResults(parsed)
      toast.success(`已生成 ${parsed.length} 组平台文案`)
    }
    catch (error: any) {
      toast.error(error?.message || '生成失败，请稍后重试')
    }
    finally {
      setIsGenerating(false)
    }
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            文案工坊
          </CardTitle>
          <CardDescription>
            输入一次产品信息，按不同平台生成差异化推广文案。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="productName">产品名称</Label>
            <Input
              id="productName"
              value={productName}
              onChange={e => setProductName(e.target.value)}
              placeholder="例如：AI 自动剪辑 SaaS 工具"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="sellingPoints">核心卖点</Label>
            <Textarea
              id="sellingPoints"
              value={sellingPoints}
              onChange={e => setSellingPoints(e.target.value)}
              placeholder="例如：10 分钟生成 50 条短视频；支持多平台一键发布；支持热点模板"
              rows={4}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="targetAudience">目标受众（可选）</Label>
              <Input
                id="targetAudience"
                value={targetAudience}
                onChange={e => setTargetAudience(e.target.value)}
                placeholder="例如：跨境电商卖家 / 本地门店老板"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tone">语气风格（可选）</Label>
              <Input
                id="tone"
                value={tone}
                onChange={e => setTone(e.target.value)}
                placeholder="例如：轻松、专业、有购买驱动"
              />
            </div>
            <div className="space-y-2">
              <Label>文案语言</Label>
              <Select value={copyLanguage} onValueChange={setCopyLanguage}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LANGUAGE_OPTIONS.map(lang => (
                    <SelectItem key={lang.value} value={lang.value}>
                      {lang.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="extraRequirements">额外要求（可选）</Label>
            <Textarea
              id="extraRequirements"
              value={extraRequirements}
              onChange={e => setExtraRequirements(e.target.value)}
              placeholder="例如：避免绝对化用语；强调免费试用；禁止承诺收益"
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>目标平台（可多选）</Label>
              <Button type="button" variant="outline" size="sm" onClick={handleToggleSelectAll}>
                {isAllSelected ? '取消全选' : '一键全选'}
              </Button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {platformOptions.map(item => (
                <label key={item.key} className="flex items-center gap-2 rounded-md border p-2 cursor-pointer">
                  <Checkbox
                    checked={selectedPlatforms.includes(item.key)}
                    onCheckedChange={() => togglePlatform(item.key)}
                  />
                  <Image src={item.icon} alt={item.label} width={20} height={20} className="w-5 h-5 rounded-full object-contain" />
                  <span className="text-sm">{item.label}</span>
                </label>
              ))}
            </div>
          </div>

          <Button onClick={handleGenerate} disabled={isGenerating} className="w-full md:w-auto">
            {isGenerating
              ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    生成中...
                  </>
                )
              : '生成平台文案'}
          </Button>
        </CardContent>
      </Card>

      {results.length > 0 && (
        <div className="space-y-4">
          {results.map(item => (
            <Card key={item.platform}>
              <CardHeader>
                <CardTitle className="text-base">{getPlatformLabel(item.platform)}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label className="text-muted-foreground">标题</Label>
                  <p className="mt-1">{item.title || '-'}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">正文</Label>
                  <p className="mt-1 whitespace-pre-wrap">{item.description}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">话题</Label>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {item.hashtags.length > 0
                      ? item.hashtags.map(tag => <Badge key={tag} variant="secondary">#{tag}</Badge>)
                      : <span className="text-sm text-muted-foreground">-</span>}
                  </div>
                </div>
                <div>
                  <Label className="text-muted-foreground">行动号召</Label>
                  <p className="mt-1">{item.cta || '-'}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

