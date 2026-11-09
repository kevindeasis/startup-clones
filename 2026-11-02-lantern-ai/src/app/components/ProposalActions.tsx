'use client';
import { ActionButton } from './ui';
export default function ProposalActions({ roleId, proposalId }: { roleId: string; proposalId: string }) {
  const url = `/api/roles/${roleId}/model`;
  return (
    <div className="flex gap-2">
      <ActionButton url={url} body={{ proposal_id: proposalId, action: 'approve' }}>Approve</ActionButton>
      <ActionButton url={url} body={{ proposal_id: proposalId, action: 'discard' }} ghost>Discard</ActionButton>
    </div>
  );
}
