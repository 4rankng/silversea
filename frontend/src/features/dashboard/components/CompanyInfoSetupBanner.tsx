import { Building2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { isCompanyInfoConfigured } from '@tingting/shared';
import { Banner } from '../../../components/shared/Banner';
import { useCompanyInfo } from '../../../hooks/useCatalogQueries';

export function CompanyInfoSetupBanner() {
  const { data: companyInfo } = useCompanyInfo();

  if (!companyInfo || isCompanyInfoConfigured(companyInfo)) return null;

  return (
    <Banner
      variant="warning"
      icon={Building2}
      sticky={false}
      nonDismissable
      action={
        <Link
          to="/config/company-info"
          className="wf-banner-action"
        >
          Bổ sung thông tin
        </Link>
      }
    >
      <strong>Chưa cấu hình thông tin công ty.</strong>{' '}
      Bổ sung thông tin pháp lý, liên hệ và tài khoản ngân hàng để chứng từ xuất ra đầy đủ.
    </Banner>
  );
}
