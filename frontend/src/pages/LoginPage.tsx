import { FormEvent, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";

import { isAuthed, login, register } from "../api";

export default function LoginPage(): JSX.Element {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [company, setCompany] = useState("苏州小棉袄电商公司");
  const [username, setUsername] = useState("demo");
  const [password, setPassword] = useState("demo123");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  if (isAuthed()) {
    return <Navigate to="/workspace" replace />;
  }

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);
    try {
      if (mode === "register") {
        if (password.length < 6) {
          throw new Error("密码至少 6 位");
        }
        if (password !== confirmPassword) {
          throw new Error("两次输入的密码不一致");
        }
        await register(company, username, password);
        setSuccess("注册成功，请使用账号登录");
        setMode("login");
        setPassword("");
        setConfirmPassword("");
      } else {
        await login(username, password);
        navigate("/workspace");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败，请重试");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="auth-layout">
      <aside className="auth-brand">
        <div className="auth-brand-content">
          <p className="eyebrow">苏州小棉袄电商公司</p>
          <h1>直播销量预测平台</h1>
          <p className="auth-summary">
            面向直播电商团队的一站式分析平台。上传直播视频后，系统自动提取声音、文本、表情等多模态特征，预测销量并给出优化建议。
          </p>

          <div className="showcase-grid">
            <article>
              <h3>直播多特征评分</h3>
              <p>实时评估声音感染力、话术质量、表情表现，定位转化关键因素。</p>
            </article>
            <article>
              <h3>销量趋势可视化</h3>
              <p>以时间序列与联动图表展示分值波动，快速识别高转化时段。</p>
            </article>
            <article>
              <h3>电商场景建议</h3>
              <p>结合评分与预测结果，输出可执行的直播优化策略。</p>
            </article>
          </div>
        </div>
      </aside>

      <div className="auth-panel">
        <div className="auth-card">
          <div className="auth-switch">
            <button
              type="button"
              className={mode === "login" ? "active" : ""}
              onClick={() => {
                setMode("login");
                setError("");
                setSuccess("");
              }}
            >
              登录
            </button>
            <button
              type="button"
              className={mode === "register" ? "active" : ""}
              onClick={() => {
                setMode("register");
                setError("");
                setSuccess("");
              }}
            >
              注册
            </button>
          </div>

          <h2>{mode === "login" ? "欢迎回来" : "创建账号"}</h2>
          <p className="muted">{mode === "login" ? "默认演示账号：demo / demo123" : "注册后可直接进入演示工作台"}</p>

          <form onSubmit={onSubmit} className="form-grid">
            {mode === "register" && (
              <label>
                公司名称
                <input value={company} onChange={(event) => setCompany(event.target.value)} placeholder="请输入公司名称" required />
              </label>
            )}

            <label>
              用户名
              <input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="请输入用户名" required />
            </label>
            <label>
              密码
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="请输入密码"
                required
              />
            </label>

            {mode === "register" && (
              <label>
                确认密码
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="请再次输入密码"
                  required
                />
              </label>
            )}

            <button disabled={loading} type="submit">
              {loading ? "处理中..." : mode === "login" ? "进入工作台" : "创建账号"}
            </button>
            {error && <p className="error">{error}</p>}
            {success && <p className="success">{success}</p>}
          </form>
        </div>
      </div>
    </section>
  );
}
