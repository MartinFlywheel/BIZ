import { getSops } from '@/lib/actions/sops'
import { getOnboardingTemplates } from '@/lib/actions/onboarding'
import { SopsList } from '@/components/sops/sops-list'

export default async function SopsPage() {
  const [sops, templates] = await Promise.all([
    getSops(),
    getOnboardingTemplates(),
  ])

  return (
    <div className="space-y-6">
      <SopsList sops={sops} templates={templates} />
    </div>
  )
}
