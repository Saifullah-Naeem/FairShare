import React, { useEffect, useState } from 'react';
import { Download, Loader2, Paperclip, X } from 'lucide-react';
import { fetchReceiptBlobUrl } from '../api/client';

interface ReceiptPreviewModalProps {
  receiptPath: string | null;
  onClose: () => void;
}

export const ReceiptPreviewModal: React.FC<ReceiptPreviewModalProps> = ({
  receiptPath,
  onClose,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    url: string;
    contentType: string;
    fileName: string;
  } | null>(null);

  useEffect(() => {
    if (!receiptPath) {
      setPreview(null);
      setError(null);
      return;
    }

    let cancelled = false;
    let createdUrl: string | null = null;
    setLoading(true);
    setError(null);

    void fetchReceiptBlobUrl(receiptPath)
      .then((res) => {
        if (cancelled) {
          URL.revokeObjectURL(res.url);
          return;
        }
        createdUrl = res.url;
        setPreview(res);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unable to load receipt.');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      if (createdUrl) {
        URL.revokeObjectURL(createdUrl);
      }
    };
  }, [receiptPath]);

  if (!receiptPath) return null;

  const isPdf = preview?.contentType.includes('pdf');

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/55 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl bg-gradient-to-br from-[#EFFBF5] to-[#F4F0FD] border border-emerald-200 p-5 pb-8 sm:pb-6 space-y-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <Paperclip className="w-4 h-4 text-emerald-700" />
            <span>Receipt Attachment</span>
          </div>
          <button
            type="button"
            aria-label="Close receipt preview"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-600 hover:text-slate-900"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {loading && (
          <div className="py-12 flex flex-col items-center gap-2 text-xs font-medium text-slate-600">
            <Loader2 className="w-6 h-6 animate-spin text-emerald-700" />
            <span>Loading receipt securely...</span>
          </div>
        )}

        {error && (
          <div className="rounded-2xl bg-rose-100 border border-rose-300 px-4 py-3 text-xs font-semibold text-rose-800">
            {error}
          </div>
        )}

        {!loading && !error && preview && (
          <div className="space-y-3">
            {isPdf ? (
              <iframe
                src={preview.url}
                title="Receipt PDF preview"
                className="w-full h-80 rounded-2xl border border-emerald-200 bg-white"
              />
            ) : (
              <div className="rounded-2xl border border-emerald-200 bg-white/80 overflow-hidden max-h-[60vh] flex items-center justify-center">
                <img
                  src={preview.url}
                  alt="Uploaded bill or payment receipt"
                  className="max-h-[58vh] w-auto object-contain"
                />
              </div>
            )}

            <a
              href={preview.url}
              download={preview.fileName}
              className="w-full min-h-[46px] rounded-2xl bg-gradient-to-r from-emerald-700 to-violet-700 text-white text-xs font-semibold flex items-center justify-center gap-2"
            >
              <Download className="w-4 h-4" />
              <span>Download Receipt</span>
            </a>
          </div>
        )}
      </div>
    </div>
  );
};
