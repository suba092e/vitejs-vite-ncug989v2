import { useState, useEffect, useRef } from 'react';
import { Calculator, MessageSquare, Send, User, Users, Sparkles, ChevronDown, ChevronUp, ShieldPlus, Baby, Settings, ArrowRight } from 'lucide-react';

// 定義單個人的資料結構
type PersonData = {
  name: string; income: number; mpf: number; vhis: number; tvc: number; rent: number;
  children: number; newborns: number; parents60: number; parents60LiveIn: number; parents55: number; parents55LiveIn: number; disabled: number;
};

// 定義最佳策略的資料結構
type BestStrategy = {
  mode: string;
  p1Tax: number;
  p2Tax: number;
  p3Tax: number;
  p4Tax: number;
  total: number;
  totalReduction: number;
  note: string;
} | null;

const defaultPerson = (name: string): PersonData => ({
  name, income: 0, mpf: 0, vhis: 0, tvc: 0, rent: 0,
  children: 0, newborns: 0, parents60: 0, parents60LiveIn: 0, parents55: 0, parents55LiveIn: 0, disabled: 0
});

export default function App() {
  // --- 1. 狀態管理 (支援 4 人獨立計算) ---
  const [formData, setFormData] = useState({
    relationship: 'single', // 'married' (代表 P1 & P2 係夫妻) 或 'single' (所有人獨立)
    livingWithChild: false,
    p1: defaultPerson('自己 (P1)'),
    p2: defaultPerson('親屬/配偶 (P2)'),
    p3: defaultPerson('親屬 (P3)'),
    p4: defaultPerson('親屬 (P4)')
  });

  // API 設定
  const apiBaseUrl = 'https://gptapi.sshworld.com/v1';
  const [apiKey, setApiKey] = useState('');
  const [modelName, setModelName] = useState('p-gemini-3.1-pro-preview-vertex');
  const [showApiSettings, setShowApiSettings] = useState(true);

  const [messages, setMessages] = useState([
    { 
      role: 'assistant', 
      content: '你好！我係你嘅專屬稅務規劃師。我依家支援最多 4 個人一齊計稅！\n\n請問你嘅婚姻狀況係點？想同邊個家人（例如配偶、兄弟姊妹）一齊比較點報稅最抵？' 
    }
  ]);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [bestStrategy, setBestStrategy] = useState<BestStrategy>(null);
  
  const [expandedSection, setExpandedSection] = useState('income');
  const chatEndRef = useRef<HTMLDivElement>(null);

  // --- 2. 稅務計算邏輯 ---
  const calculateHKTax = (income: number, deductions: number, allowances: number) => {
    let netIncome = Math.max(0, income - deductions);
    let standardTax = netIncome <= 5000000 ? netIncome * 0.15 : (5000000 * 0.15) + ((netIncome - 5000000) * 0.16);
    let netChargeable = Math.max(0, netIncome - allowances);
    let progressiveTax = 0;
    let n = netChargeable;
    if (n > 0) { let step = Math.min(n, 50000); progressiveTax += step * 0.02; n -= step; }
    if (n > 0) { let step = Math.min(n, 50000); progressiveTax += step * 0.06; n -= step; }
    if (n > 0) { let step = Math.min(n, 50000); progressiveTax += step * 0.10; n -= step; }
    if (n > 0) { let step = Math.min(n, 50000); progressiveTax += step * 0.14; n -= step; }
    if (n > 0) { progressiveTax += n * 0.17; }

    let baseTax = Math.min(standardTax, progressiveTax);
    let taxReduction = Math.min(baseTax, 3000); // 2025/26 寬減
    return { finalTax: baseTax - taxReduction, baseTax, reduction: taxReduction };
  };

  const getPersonNet = (p: PersonData) => {
    const rentCap = formData.livingWithChild ? 120000 : 100000;
    const deductions = Math.min(p.mpf, 18000) + p.vhis + Math.min(p.tvc, 60000) + Math.min(p.rent, rentCap);
    const allowances = (p.children * 130000) + (p.newborns * 260000) + (p.parents60 * 50000) + (p.parents60LiveIn * 100000) + (p.parents55 * 25000) + (p.parents55LiveIn * 50000) + (p.disabled * 75000);
    return { income: p.income, deductions, allowances };
  };

  const optimizeTax = (data: typeof formData) => {
    const n1 = getPersonNet(data.p1);
    const n2 = getPersonNet(data.p2);
    const n3 = getPersonNet(data.p3);
    const n4 = getPersonNet(data.p4);

    // 計算 P3 同 P4 嘅獨立稅款 (佢哋永遠係獨立計算)
    const t3 = calculateHKTax(n3.income, n3.deductions, n3.allowances + 132000);
    const t4 = calculateHKTax(n4.income, n4.deductions, n4.allowances + 132000);
    const othersTax = t3.finalTax + t4.finalTax;
    const othersReduction = t3.reduction + t4.reduction;

    let best: BestStrategy = null; 
    let minTotalTax = Infinity;

    const compare = (mode: string, t1: any, t2: any, note: string) => {
      const total = t1.finalTax + t2.finalTax + othersTax;
      if (total < minTotalTax) {
        minTotalTax = total;
        best = { 
          mode, 
          p1Tax: t1.finalTax, p2Tax: t2.finalTax, p3Tax: t3.finalTax, p4Tax: t4.finalTax, 
          total, totalReduction: t1.reduction + t2.reduction + othersReduction, note 
        };
      }
    };

    if (data.relationship === 'married') {
      compare('分開評稅', calculateHKTax(n1.income, n1.deductions, n1.allowances + 132000), calculateHKTax(n2.income, n2.deductions, n2.allowances), `${data.p1.name} 申索所有家庭免稅額`);
      compare('分開評稅', calculateHKTax(n1.income, n1.deductions, n1.allowances), calculateHKTax(n2.income, n2.deductions, n2.allowances + 132000), `${data.p2.name} 申索所有家庭免稅額`);
      
      const joint = calculateHKTax(n1.income + n2.income, n1.deductions + n2.deductions, n1.allowances + n2.allowances + 264000);
      if (joint.finalTax + othersTax < minTotalTax) {
        minTotalTax = joint.finalTax + othersTax;
        best = { 
          mode: '合併評稅 (P1+P2)', 
          p1Tax: joint.finalTax, p2Tax: 0, p3Tax: t3.finalTax, p4Tax: t4.finalTax, 
          total: minTotalTax, totalReduction: joint.reduction + othersReduction, note: 'P1 同 P2 合併評稅最慳稅' 
        };
      }
    } else {
      compare('各自報稅', calculateHKTax(n1.income, n1.deductions, n1.allowances + 132000), calculateHKTax(n2.income, n2.deductions, n2.allowances), `${data.p1.name} 申索所有家庭免稅額`);
      compare('各自報稅', calculateHKTax(n1.income, n1.deductions, n1.allowances), calculateHKTax(n2.income, n2.deductions, n2.allowances + 132000), `${data.p2.name} 申索所有家庭免稅額`);
    }
    setBestStrategy(best);
  };

  useEffect(() => { optimizeTax(formData); }, [formData]);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  // --- 3. AI Agent Logic ---
  const handleSendMessage = async () => {
    if (!inputMessage.trim()) return;
    if (!apiKey) { alert("請先輸入 Key！"); setShowApiSettings(true); return; }

    const userMsg = inputMessage;
    setInputMessage('');
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setIsLoading(true);

    try {
      const systemPrompt = `
        你是一個主動、專業的香港稅務 AI 顧問。
        
        【當前計算器狀態 (JSON)】: ${JSON.stringify(formData)}
        
        【你的行為準則與邏輯 (極重要)】:
        1. **人物分配**: 
           - 系統支援 4 個人 (p1, p2, p3, p4)。
           - 如果用戶說「我同細佬」，請將用戶放 p1，細佬放 p2。
           - 如果用戶說「單身，有兄弟」，relationship 必須設為 "single" (代表非夫妻)。
           - 如果用戶說「已婚」，relationship 設為 "married"。
        2. **入息處理**: 如果用戶說月薪 55k，請自動 x12 變成 660000 填入 income。
        3. **免稅額獨立分配 (互斥原則)**:
           - 父母免稅額是**跟人**的。如果用戶問「父母應該由我定細佬報？」，你必須在腦中計算誰的邊際稅率高，然後將父母免稅額分配給那個人。
           - 例如：決定由 p2 報 1 個同住 60歲父母，則 \`p2.parents60LiveIn = 1\`，而 \`p1.parents60LiveIn = 0\`。
           - 絕對不能兩個人同時報同一個父母！
        
        【極度重要】：你必須且只能返回一個純 JSON 格式的字串。絕對不要包含任何 Markdown 標記。
        
        JSON 格式:
        {
          "newState": { 
            "relationship": "single 或 married",
            "p1": { "income": 660000, "parents60LiveIn": 0, ... },
            "p2": { "income": 648000, "parents60LiveIn": 1, ... }
          },
          "reply": "你的廣東話回覆。解釋你將邊個放咗喺 P1/P2，同埋免稅額分配咗畀邊個最抵。"
        }
      `;

      const endpoint = `${apiBaseUrl.replace(/\/$/, '')}/chat/completions`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ 
          model: modelName, 
          messages: [
            { role: 'system', content: systemPrompt }, 
            { role: 'user', content: userMsg }
          ], 
          temperature: 0.1 
        })
      });

      const data = await response.json();
      if (data.error) throw new Error(data.error.message);
      
      let aiText = data.choices[0].message.content;
      aiText = aiText.replace(/```json/gi, '').replace(/```/g, '').trim();
      const jsonMatch = aiText.match(/\{[\s\S]*\}/);
      if (jsonMatch) aiText = jsonMatch[0];
      
      const aiResponse = JSON.parse(aiText);
      
      if (aiResponse.newState) {
        setFormData(prev => {
          const next = { ...prev };
          if (aiResponse.newState.relationship) next.relationship = aiResponse.newState.relationship;
          if (aiResponse.newState.livingWithChild !== undefined) next.livingWithChild = aiResponse.newState.livingWithChild;
          ['p1', 'p2', 'p3', 'p4'].forEach(k => {
            if (aiResponse.newState[k]) {
              next[k as keyof typeof next] = { ...(next[k as keyof typeof next] as PersonData), ...aiResponse.newState[k] };
            }
          });
          return next;
        });
      }
      setMessages(prev => [...prev, { role: 'assistant', content: aiResponse.reply }]);

    } catch (error: any) {
      setMessages(prev => [...prev, { role: 'assistant', content: `發生錯誤：${error.message}` }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePersonChange = (personKey: string, field: string, value: number | string) => {
    setFormData(prev => {
      const person = prev[personKey as keyof typeof prev] as PersonData;
      const updatedPerson = { ...person, [field]: value };
      if (field === 'income') updatedPerson.mpf = Math.min((value as number) * 0.05, 18000);
      return { ...prev, [personKey]: updatedPerson };
    });
  };

  // --- 4. 內置樣式 (CSS-in-JS) ---
  const s = {
    container: { fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif', backgroundColor: '#f2f2f7', height: '100dvh', display: 'flex', flexDirection: 'column' as const, overflow: 'hidden' },
    topSection: { flex: 1.5, minHeight: '50%', display: 'flex', flexDirection: 'column' as const, transition: 'all 0.3s ease', backgroundColor: '#f2f2f7', borderBottom: '1px solid #d1d5db', overflow: 'hidden' },
    header: { backgroundColor: '#007AFF', color: 'white', padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 2px 10px rgba(0,0,0,0.1)', zIndex: 10, flexShrink: 0 },
    headerTitle: { fontWeight: '600', fontSize: '18px', display: 'flex', alignItems: 'center', gap: '8px' },
    scrollArea: { flex: 1, overflowY: 'auto' as const, padding: '16px', paddingBottom: '120px', display: 'flex', flexDirection: 'column' as const, gap: '12px', WebkitOverflowScrolling: 'touch' as const },
    bottomSection: { flex: 1, display: 'flex', flexDirection: 'column' as const, backgroundColor: '#f2f2f7', overflow: 'hidden', minHeight: 0 },
    chatScrollArea: { flex: 1, overflowY: 'auto' as const, padding: '16px', display: 'flex', flexDirection: 'column' as const, gap: '12px' },
    card: { backgroundColor: 'white', borderRadius: '16px', padding: '16px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)', border: '1px solid rgba(0,0,0,0.05)' },
    bestCard: { backgroundColor: '#ecfdf5', border: '1px solid #10b981', borderRadius: '16px', padding: '16px', boxShadow: '0 4px 12px rgba(16, 185, 129, 0.1)' },
    sectionBtn: (active: boolean, color: string) => ({ width: '100%', padding: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: active ? 'white' : '#f9fafb', border: 'none', borderBottom: '1px solid #eee', color: color, fontWeight: '600', cursor: 'pointer', outline: 'none' }),
    inputGroup: { marginBottom: '12px' },
    label: { display: 'block', fontSize: '12px', fontWeight: '600', color: '#6b7280', marginBottom: '4px' },
    input: { width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #d1d5db', fontSize: '14px', outline: 'none', transition: 'border-color 0.2s', backgroundColor: 'white', boxSizing: 'border-box' as const },
    msgBubble: (isUser: boolean) => ({ maxWidth: '85%', padding: '10px 16px', borderRadius: '18px', fontSize: '15px', lineHeight: '1.4', backgroundColor: isUser ? '#007AFF' : 'white', color: isUser ? 'white' : '#1f2937', alignSelf: isUser ? 'flex-end' : 'flex-start', boxShadow: '0 1px 2px rgba(0,0,0,0.1)', borderBottomRightRadius: isUser ? '4px' : '18px', borderBottomLeftRadius: isUser ? '18px' : '4px' }),
    inputBar: { padding: '12px', backgroundColor: 'white', borderTop: '1px solid #e5e7eb', display: 'flex', gap: '8px', alignItems: 'center', flexShrink: 0 },
    sendBtn: { backgroundColor: '#007AFF', color: 'white', border: 'none', borderRadius: '50%', width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' },
    settingsLabel: { fontSize: '11px', fontWeight: '600', color: '#6b7280', marginBottom: '4px', display: 'block' },
    horizontalScroll: { display: 'flex', overflowX: 'auto' as const, gap: '16px', paddingBottom: '8px', WebkitOverflowScrolling: 'touch' as const },
    personColumn: { minWidth: '220px', flexShrink: 0, borderRight: '1px solid #f3f4f6', paddingRight: '16px' }
  };

  const PersonInput = ({ pKey, label, field, maxText }: any) => {
    const val = (formData[pKey as keyof typeof formData] as any)[field];
    return (
      <div style={s.inputGroup}>
        <label style={s.label}>{label}</label>
        <input type="number" value={val === 0 ? '' : val} placeholder="0" onChange={(e) => handlePersonChange(pKey, field, Number(e.target.value) || 0)} style={s.input} className="no-spinners" />
        {maxText && <div style={{ fontSize: '10px', color: '#9ca3af', marginTop: '2px' }}>{maxText}</div>}
      </div>
    );
  };

  const persons = ['p1', 'p2', 'p3', 'p4'];

  return (
    <>
      <style>{`
        * { box-sizing: border-box; } 
        body { margin: 0; padding: 0; } 
        ::-webkit-scrollbar { height: 6px; width: 6px; } 
        ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
        
        input[type=number].no-spinners::-webkit-inner-spin-button, 
        input[type=number].no-spinners::-webkit-outer-spin-button { 
          -webkit-appearance: none; 
          margin: 0; 
        }
        input[type=number].no-spinners { 
          -moz-appearance: textfield; 
        }
      `}</style>
      
      <div style={s.container}>
        {/* Top Half: Calculator */}
        <div style={s.topSection}>
          <div style={s.header}>
            <div style={s.headerTitle}><Calculator size={20} /> 香港稅務最佳化計算器</div>
          </div>

          <div style={s.scrollArea}>
            {(formData.p1.income > 0 || formData.p2.income > 0 || formData.p3.income > 0 || formData.p4.income > 0) && bestStrategy && (
              <div style={s.bestCard}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#047857', fontWeight: 'bold', marginBottom: '8px' }}>
                  <Sparkles size={18} /> 最抵繳稅方案: {bestStrategy.mode}
                </div>
                <p style={{ color: '#065f46', fontSize: '14px', marginBottom: '12px' }}>{bestStrategy.note}</p>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                  <div style={{ fontSize: '13px', color: '#4b5563' }}>
                    {bestStrategy.mode !== '合併評稅 (P1+P2)' && (
                      <>
                        {formData.p1.income > 0 && <div>{formData.p1.name}: ${Math.round(bestStrategy.p1Tax).toLocaleString()}</div>}
                        {formData.p2.income > 0 && <div>{formData.p2.name}: ${Math.round(bestStrategy.p2Tax).toLocaleString()}</div>}
                      </>
                    )}
                    {formData.p3.income > 0 && <div>{formData.p3.name}: ${Math.round(bestStrategy.p3Tax).toLocaleString()}</div>}
                    {formData.p4.income > 0 && <div>{formData.p4.name}: ${Math.round(bestStrategy.p4Tax).toLocaleString()}</div>}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '12px', color: '#6b7280' }}>總應繳稅款</div>
                    <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#047857' }}>${Math.round(bestStrategy.total).toLocaleString()}</div>
                    {bestStrategy.totalReduction > 0 && <div style={{ fontSize: '11px', color: '#059669' }}>(已扣減 ${Math.round(bestStrategy.totalReduction).toLocaleString()} 寬減)</div>}
                  </div>
                </div>
              </div>
            )}

            <div style={{ ...s.card, padding: 0 }}>
              {/* Section 1: 入息 */}
              <button onClick={() => setExpandedSection(expandedSection === 'income' ? '' : 'income')} style={s.sectionBtn(expandedSection === 'income', '#1e40af')}>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}><User size={16}/> 入息及強積金</div>{expandedSection === 'income' ? <ChevronUp size={16}/> : <ChevronDown size={16}/>}
              </button>
              {expandedSection === 'income' && (
                <div style={{ padding: '16px' }}>
                  <div style={s.inputGroup}>
                    <label style={s.label}><Users size={14} style={{display:'inline', marginRight:4}}/> P1 與 P2 關係 (P3, P4 預設為獨立親屬)</label>
                    <select value={formData.relationship} onChange={(e) => setFormData({...formData, relationship: e.target.value})} style={s.input}>
                      <option value="single">單身 / 兄弟姊妹 (各自獨立)</option>
                      <option value="married">夫妻 (可合併評稅)</option>
                    </select>
                  </div>
                  <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '4px' }}><ArrowRight size={12}/> 向左滑動查看 P3, P4</div>
                  <div style={s.horizontalScroll}>
                    {persons.map(pKey => (
                      <div key={pKey} style={s.personColumn}>
                        <div style={{ fontWeight: 'bold', fontSize: '14px', marginBottom: '8px', borderBottom: '1px solid #eee', paddingBottom: '4px' }}>
                          <input type="text" value={(formData as any)[pKey].name} onChange={(e) => handlePersonChange(pKey, 'name', e.target.value)} style={{ border: 'none', outline: 'none', width: '100%', fontWeight: 'bold', color: '#1f2937' }} />
                        </div>
                        <PersonInput pKey={pKey} label="年薪" field="income" />
                        <PersonInput pKey={pKey} label="強積金" field="mpf" maxText="上限 $18,000" />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Section 2: 扣稅 */}
              <button onClick={() => setExpandedSection(expandedSection === 'deductions' ? '' : 'deductions')} style={s.sectionBtn(expandedSection === 'deductions', '#166534')}>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}><ShieldPlus size={16}/> 扣稅項目</div>{expandedSection === 'deductions' ? <ChevronUp size={16}/> : <ChevronDown size={16}/>}
              </button>
              {expandedSection === 'deductions' && (
                <div style={{ padding: '16px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', marginBottom: '12px', padding: '8px', backgroundColor: '#f3f4f6', borderRadius: '8px' }}>
                    <input type="checkbox" checked={formData.livingWithChild} onChange={(e) => setFormData({...formData, livingWithChild: e.target.checked})} /> 與子女同住 (租金扣除上限 12萬)
                  </label>
                  <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '4px' }}><ArrowRight size={12}/> 向左滑動查看 P3, P4</div>
                  <div style={s.horizontalScroll}>
                    {persons.map(pKey => (
                      <div key={pKey} style={s.personColumn}>
                        <div style={{ fontWeight: 'bold', fontSize: '14px', marginBottom: '8px', color: '#374151' }}>{(formData as any)[pKey].name}</div>
                        <PersonInput pKey={pKey} label="自願醫保" field="vhis" />
                        <PersonInput pKey={pKey} label="年金/TVC" field="tvc" />
                        <PersonInput pKey={pKey} label="租金/利息" field="rent" />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Section 3: 免稅額 */}
              <button onClick={() => setExpandedSection(expandedSection === 'allowances' ? '' : 'allowances')} style={s.sectionBtn(expandedSection === 'allowances', '#6b21a8')}>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}><Baby size={16}/> 家庭免稅額 (獨立分配)</div>{expandedSection === 'allowances' ? <ChevronUp size={16}/> : <ChevronDown size={16}/>}
              </button>
              {expandedSection === 'allowances' && (
                <div style={{ padding: '16px' }}>
                  <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '4px' }}><ArrowRight size={12}/> 向左滑動查看 P3, P4</div>
                  <div style={s.horizontalScroll}>
                    {persons.map(pKey => (
                      <div key={pKey} style={s.personColumn}>
                        <div style={{ fontWeight: 'bold', fontSize: '14px', marginBottom: '8px', color: '#374151' }}>{(formData as any)[pKey].name}</div>
                        <PersonInput pKey={pKey} label="子女數目" field="children" />
                        <PersonInput pKey={pKey} label="初生嬰兒" field="newborns" />
                        <PersonInput pKey={pKey} label="60歲+父母(非同住)" field="parents60" />
                        <PersonInput pKey={pKey} label="60歲+父母(同住)" field="parents60LiveIn" />
                        <PersonInput pKey={pKey} label="55歲+父母(非同住)" field="parents55" />
                        <PersonInput pKey={pKey} label="55歲+父母(同住)" field="parents55LiveIn" />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Bottom Half: Chat */}
        <div style={s.bottomSection}>
          <div style={{ backgroundColor: 'white', borderBottom: '1px solid #e5e7eb', flexShrink: 0 }}>
            <button onClick={() => setShowApiSettings(!showApiSettings)} style={{ width: '100%', padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer' }}>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}><Settings size={14} /> API 設定</div>{showApiSettings ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            {showApiSettings && (
              <div style={{ padding: '12px 16px', backgroundColor: '#f9fafb', borderTop: '1px solid #f3f4f6', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div>
                  <label style={s.settingsLabel}>Model</label>
                  <select value={modelName} onChange={(e) => setModelName(e.target.value)} style={s.input}>
                    <option value="p-gemini-3.1-pro-preview-vertex">p-gemini-3.1-pro-preview-vertex</option>
                    <option value="p-gemini-3.0-pro-preview">p-gemini-3.0-pro-preview</option>
                  </select>
                </div>
                <div>
                  <label style={s.settingsLabel}>Key</label>
                  <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="輸入 Key..." style={s.input} />
                </div>
              </div>
            )}
          </div>

          <div style={s.chatScrollArea}>
            {messages.map((msg, idx) => (
              <div key={idx} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                <div style={s.msgBubble(msg.role === 'user')}>{msg.content}</div>
              </div>
            ))}
            {isLoading && <div style={{ alignSelf: 'flex-start', color: '#9ca3af', fontSize: '12px', marginLeft: '16px' }}>AI 思考中...</div>}
            <div ref={chatEndRef} />
          </div>

          <div style={s.inputBar}>
            <MessageSquare size={20} color="#9ca3af" />
            <input type="text" placeholder="同 AI 講你想點計..." value={inputMessage} onChange={(e) => setInputMessage(e.target.value)} onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()} style={{ flex: 1, border: 'none', outline: 'none', fontSize: '15px' }} />
            <button onClick={handleSendMessage} disabled={isLoading || !inputMessage.trim()} style={{ ...s.sendBtn, opacity: (!inputMessage.trim() || isLoading) ? 0.5 : 1 }}>
              <Send size={18} />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}