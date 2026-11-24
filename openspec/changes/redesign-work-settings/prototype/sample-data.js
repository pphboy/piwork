// Synthetic prototype data only.
    const paths = {
      back: '<path d="m12 5-7 7 7 7M5 12h14"/>',
      chevron: '<path d="m9 5 7 7-7 7"/>',
      down: '<path d="m5 9 7 7 7-7"/>',
      plus: '<path d="M12 5v14M5 12h14"/>',
      file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h5"/>',
      folder: '<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
      skill: '<path d="m12 3 3.1 5.8 6.4 1.2-4.5 4.7.8 6.3-5.8-2.9L6.2 21l.8-6.3L2.5 10l6.4-1.2z"/>',
      grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
      chat: '<path d="M21 14a3 3 0 0 1-3 3H9l-6 4V6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3zM7 7h10M7 11h7"/>',
      check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
      clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
      save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2ZM7 3v6h10V3M7 21v-8h10v8"/>',
      search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
      close: '<path d="m6 6 12 12M6 18 18 6"/>',
      info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
      refresh: '<path d="M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 2M18 18a8 8 0 0 1-13-2"/>',
      box: '<path d="m12 3 9 5v9l-9 5-9-5V8zM3 8l9 5 9-5M12 13v9M7.5 5.5l9 5"/>',
      gear: '<path d="m9 3-1 3-3 1-2 5 2 5 3 1 1 3h6l1-3 3-1 2-5-2-5-3-1-1-3z"/><circle cx="12" cy="12" r="3"/>',
      more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
      edit: '<path d="m16 3 5 5-13 13H3v-5zM13 6l5 5"/>'
    };
    const icon = name => '<svg viewBox="0 0 24 24" aria-hidden="true">' + (paths[name] || paths.file) + '</svg>';
    const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const clone = value => structuredClone(value);
    const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
    const templates = [
      { name:'code-review', description:'检查代码质量，给出具体的修改建议', files:{
        'SKILL.md':'---\nname: code-review\ndescription: 检查代码质量，给出具体的修改建议\n---\n\n# Code review\n\n审查代码时，先理解变更要解决的问题。\n\n## 审查重点\n\n- 检查实现是否符合预期行为。\n- 优先指出会影响用户的问题。\n- 给出可执行、可验证的修改建议。\n- 避免把个人偏好写成必须修改的问题。\n\n## 输出格式\n\n按严重程度列出发现，并标注文件位置。\n必要时参考 references/checklist.md。\n',
        'references/checklist.md':'# Review checklist\n\n## 正确性\n\n- 输入和输出是否符合约定？\n- 异常路径是否保留用户数据？\n\n## 可维护性\n\n- 修改是否有清楚的责任边界？\n- 是否引入了重复实现？\n'
      }},
      { name:'web-research', description:'查找资料，并保留可以核对的来源', files:{
        'SKILL.md':'---\nname: web-research\ndescription: 查找资料，并保留可以核对的来源\n---\n\n# Web research\n\n先明确要回答的问题，再查找原始来源。\n\n- 优先使用官方文档和研究原文。\n- 核对资料的时间与适用范围。\n- 区分事实、推断和仍不确定的内容。\n- 在结论附近附上来源链接。\n',
        'references/sources.md':'# Sources\n\n记录原始页面、发布日期和关键依据。\n'
      }},
      { name:'writing', description:'整理结构，写出清楚、简洁的文字', files:{
        'SKILL.md':'---\nname: writing\ndescription: 整理结构，写出清楚、简洁的文字\n---\n\n# Writing\n\n先交代读者需要知道的结论。\n\n使用熟悉的词，写具体的事。\n让每段文字只承担一个主要任务。\n删去不帮助理解的修饰和重复解释。\n'
      }},
      { name:'data-analysis', description:'检查数据、解释趋势并核对计算结果', files:{
        'SKILL.md':'---\nname: data-analysis\ndescription: 检查数据、解释趋势并核对计算结果\n---\n\n# Data analysis\n\n先检查数据来源、字段含义与缺失值。\n\n分析结果应包含方法、结论和限制。\n使用图表时，明确标注单位与时间范围。\n'
      }},
      { name:'interface-design', description:'梳理页面结构和用户操作路径', files:{
        'SKILL.md':'---\nname: interface-design\ndescription: 梳理页面结构和用户操作路径\n---\n\n# Interface design\n\n从用户要完成的任务开始。\n为每个动作提供明确的对象和反馈。\n'
      }}
    ];
    const initial = { skills:clone(templates.slice(0,3)), packages:[{name:'piwork-brain',description:'Work 的基础 Agent 能力与工作流程',source:'Core 包库',enabled:true}], agents:'# Work instructions\n\n你正在协助维护一个软件项目。\n\n## 工作方式\n\n- 修改前先理解已有行为与约束。\n- 使用中文沟通，保留代码中的英文标识符。\n- 完成后说明修改内容和验证结果。\n' };
