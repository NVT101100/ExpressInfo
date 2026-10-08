export default function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const pageCount = Math.ceil(total / pageSize);
  if (pageCount <= 1) return null;

  return (
    <nav className="pagination" aria-label="Phân trang">
      <button
        className="button secondary"
        disabled={page === 0}
        onClick={() => onPageChange(page - 1)}
      >
        ← Trước
      </button>
      <span>Trang {page + 1} / {pageCount} · {total} mục</span>
      <button
        className="button secondary"
        disabled={page + 1 >= pageCount}
        onClick={() => onPageChange(page + 1)}
      >
        Sau →
      </button>
    </nav>
  );
}
