import { Link } from 'react-router-dom';
import { homeForRole } from '../lib/routes';
import { useAuth } from '../hooks/useAuth';
import './NotFoundPage.css';

export default function NotFoundPage() {
  const { user } = useAuth();
  return <section className="not-found-page" aria-labelledby="not-found-title">
    <p className="not-found-page__code" aria-hidden="true">404</p>
    <h1 id="not-found-title">Không tìm thấy trang</h1>
    <p>Trang này có thể đã được chuyển hoặc không còn tồn tại. Hãy mở lại từ menu điều hướng.</p>
    <Link className="btn btn--primary" to={homeForRole(user?.role ?? '')}>Về trang chính</Link>
  </section>;
}
