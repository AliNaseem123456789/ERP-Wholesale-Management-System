import React from 'react';
import { Link, useLocation } from 'react-router-dom';

export const Breadcrumbs: React.FC = () => {
  const location = useLocation();
  const pathname = location.pathname;

  if (pathname === '/') return null;

  const pathParts = pathname.split('/').filter(Boolean);

  return (
    <nav className="bg-white-100 dark:bg-[#11172a] px-6 py-3 text-sm text-gray-700 dark:text-gray-300 rounded-md mb-6 max-w-7xl mx-auto">
      <ol className="flex flex-wrap items-center space-x-2">
        <li>
          <Link to="/" className="hover:underline">
            Home
          </Link>
          <span className="mx-1">/</span>
        </li>
        {pathParts.map((part, index) => {
          const isLast = index === pathParts.length - 1;
          const href = '/' + pathParts.slice(0, index + 1).join('/');

          // Decode URL and replace hyphens/underscores with spaces
          const name = decodeURIComponent(part).replace(/[-_]/g, ' ');

          return (
            <li key={href}>
              {isLast ? (
                <span className="font-semibold">{name}</span>
              ) : (
                <>
                  <Link to={href} className="hover:underline">
                    {name}
                  </Link>
                  <span className="mx-1">/</span>
                </>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
};
