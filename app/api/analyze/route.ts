import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const image = body?.image as string | undefined;
    const question = (body?.question as string | undefined) || "";
    const context = (body?.context as string | undefined) || "";

    if (!image) {
      return NextResponse.json({ error: "缺少页面图片" }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({
        error: "尚未配置 OPENAI_API_KEY。请在部署环境中添加后重启服务。",
        needsSetup: true,
      }, { status: 503 });
    }

    const system = `你是温和、准确、适合实时陪读的 AI 阅读伙伴。
请同时识别图片中的书页文字和插图，并按以下规则工作：
1. 不确定的文字不要臆测；识别不完整时明确说明。
2. 区分文本、插图、公式、题目和书页装饰。
3. 用户没提问时，给出简短的页面讲解，并提出最多一个有启发性的后续问题。
4. 如果是题目，默认先提示或引导，不直接报完整答案；用户明确要求答案时再详细解答。
5. 儿童读物使用自然易懂的语言；其他读物保持准确并可选择深度。
6. 不把通俗补充说成教材原文。
7. 只返回 JSON，不要使用 Markdown。字段：title, text, illustration, mode, pageSummary, response, needsClarification。`;

    const userText = `阅读上下文：${context || "暂无"}\n用户当前指令：${question || "请识别并陪我阅读这一页"}`;

    const openAIResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.4,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          {
            role: "user",
            content: [
              { type: "text", text: userText },
              { type: "image_url", image_url: { url: image, detail: "high" } },
            ],
          },
        ],
      }),
    });

    if (!openAIResponse.ok) {
      const detail = await openAIResponse.text();
      return NextResponse.json({
        error: "AI 服务调用失败",
        detail: detail.slice(0, 500),
      }, { status: 502 });
    }

    const completion = await openAIResponse.json();
    const content = completion.choices?.[0]?.message?.content;

    if (!content) {
      return NextResponse.json({ error: "AI 未返回可用内容" }, { status: 502 });
    }

    try {
      return NextResponse.json(JSON.parse(content));
    } catch {
      return NextResponse.json({
        text: content,
        response: content,
        pageSummary: "已识别到页面，但返回格式需要校验。",
        mode: "reading",
      });
    }
  } catch (error) {
    return NextResponse.json({
      error: "服务器处理失败",
      detail: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}
