import { Link, Navigate, Route, Routes, useNavigate } from "react-router-dom";

import { getActiveUser, isAuthed, logout } from "./api";
import LoginPage from "./pages/LoginPage";
import UploadPage from "./pages/UploadPage";

function ProtectedRoute({ children }: { children: JSX.Element }): JSX.Element {
  if (!isAuthed()) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

function TopBar(): JSX.Element {
  const navigate = useNavigate();
  const authed = isAuthed();
  const activeUser = getActiveUser();

  return (
    <header className="topbar">
      <div className="brand">苏州小棉袄电商公司 · 直播销量预测平台</div>
      <nav>
        {authed && <Link to="/workspace">工作台</Link>}
        {!authed && <Link to="/login">登录</Link>}
        {authed && <span className="user-pill">{activeUser}</span>}
        {authed && (
          <button
            className="text-btn"
            onClick={() => {
              logout();
              navigate("/login");
            }}
            type="button"
          >
            退出登录
          </button>
        )}
      </nav>
    </header>
  );
}

export default function App(): JSX.Element {
  return (
    <div className="app-shell">
      <TopBar />
      <main className="content">
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/workspace"
            element={
              <ProtectedRoute>
                <UploadPage />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to={isAuthed() ? "/workspace" : "/login"} replace />} />
        </Routes>
      </main>
    </div>
  );
}
