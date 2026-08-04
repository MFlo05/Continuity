import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { ExtraContact } from '../../data-sources/class-contacts';

interface Props {
  onCancel:  () => void;
  onConfirm: (contact: ExtraContact) => void;
}

// For contacts that aren't tied to a specific class (student services, an
// advisor, etc.) — teachers themselves are derived automatically from each
// class's Teacher field (Class Settings), not added here.
export function AddContactModal({ onCancel, onConfirm }: Props) {
  const [name,  setName]  = useState('');
  const [role,  setRole]  = useState('');
  const [email, setEmail] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => { nameRef.current?.focus(); }, []);

  const trimmedName = name.trim();
  const canConfirm   = trimmedName.length > 0;
  const confirm = () => {
    if (!canConfirm) return;
    onConfirm({ name: trimmedName, role: role.trim() || 'Other', email: email.trim() || undefined });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onCancel(); return; }
      if (e.key === 'Enter' && canConfirm) confirm();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canConfirm, trimmedName, role, email]);

  return createPortal(
    <div className="cc2-modal-backdrop" onMouseDown={onCancel}>
      <div className="cc2-modal cc2-setup-modal" onMouseDown={e => e.stopPropagation()}>

        <div className="cc2-modal-header">
          <span className="cc2-modal-title">New Contact</span>
          <button className="cc2-modal-close" onClick={onCancel}>✕</button>
        </div>

        <div className="cc2-setup-body">
          <p className="cc2-setup-hint">
            For contacts that aren't tied to a specific class — student services, an advisor, etc.
          </p>

          <input
            ref={nameRef}
            type="text"
            className="cc2-setup-input"
            placeholder="Name"
            value={name}
            onChange={e => setName(e.target.value)}
          />
          <input
            type="text"
            className="cc2-setup-input"
            placeholder="Role, e.g. Student Services"
            value={role}
            onChange={e => setRole(e.target.value)}
          />
          <input
            type="text"
            className="cc2-setup-input"
            placeholder="Email (optional)"
            value={email}
            onChange={e => setEmail(e.target.value)}
          />
        </div>

        <div className="cc2-setup-footer">
          <button className="cc2-setup-cancel" onClick={onCancel}>Cancel</button>
          <button className="cc2-setup-confirm" onClick={confirm} disabled={!canConfirm}>
            Add Contact
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
