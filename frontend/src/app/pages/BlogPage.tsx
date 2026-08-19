import { useState, useEffect } from "react";
import { Link, useParams } from "react-router";
import { Button } from "../components/ui/button";
import { ThemeToggle } from "../components/ThemeToggle";
import { ArrowRight, Calendar, User, Search, ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { useSEO } from "../hooks/useSEO";

interface BlogPost {
  id: number;
  title: string;
  slug: string;
  excerpt: string;
  body?: string;
  source: string;
  source_url?: string;
  category: string;
  author: string;
  published_at: string;
  featured_image?: string;
  related?: BlogPost[];
}

interface BlogListResponse {
  posts: BlogPost[];
  total: number;
  page: number;
  totalPages: number;
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-KE", { year: "numeric", month: "short", day: "numeric" });
}

function sourceColor(source: string) {
  const s = source.toLowerCase();
  if (s.includes("mystocks")) return "bg-emerald-500/10 text-emerald-600";
  if (s.includes("nse")) return "bg-blue-500/10 text-blue-600";
  if (s.includes("benzinga")) return "bg-purple-500/10 text-purple-600";
  if (s.includes("cnbc") || s.includes("marketwatch") || s.includes("ft") || s.includes("guardian")) return "bg-amber-500/10 text-amber-600";
  if (s.includes("kenyan")) return "bg-orange-500/10 text-orange-600";
  return "bg-gray-500/10 text-gray-600";
}

// ─── Blog Listing ────────────────────────────────────────────────────────────

function BlogList() {
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [categories, setCategories] = useState<{ category: string; count: number }[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useSEO({
    title: "Blog",
    description: "Latest insights, analysis, and market intelligence from African and global stock markets.",
    canonical: "/blog",
    keywords: "stock market blog, African markets news, NSE Kenya analysis, market intelligence",
  });

  useEffect(() => {
    fetch("/api/blog/categories")
      .then((r) => r.json())
      .then((d) => setCategories(d))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: "12" });
    if (selectedCategory) params.set("category", selectedCategory);
    if (search) params.set("search", search);
    fetch(`/api/blog?${params}`)
      .then((r) => r.json())
      .then((d: BlogListResponse) => {
        setPosts(d.posts || []);
        setTotal(d.total || 0);
        setTotalPages(d.totalPages || 1);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [page, selectedCategory, search]);

  return (
    <>
      <section className="pt-32 pb-8">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <p className="text-[#0D7490] font-semibold text-sm uppercase tracking-wider mb-3">Blog</p>
          <h1 className="text-4xl sm:text-5xl font-bold text-foreground mb-4">Market Intelligence</h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Curated coverage from African exchanges, global markets, and financial news — updated automatically throughout the day.
          </p>
        </div>
      </section>

      <section className="pb-8">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center gap-3 mb-6">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search articles..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                className="w-full pl-9 pr-4 py-2.5 bg-card border border-border rounded-xl text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[#0D7490]/30"
              />
            </div>
          </div>
          {categories.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-8">
              <button
                onClick={() => { setSelectedCategory(null); setPage(1); }}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${!selectedCategory ? "bg-[#0D7490] text-white" : "bg-card border border-border text-muted-foreground hover:text-foreground"}`}
              >
                All ({total})
              </button>
              {categories.map((c) => (
                <button
                  key={c.category}
                  onClick={() => { setSelectedCategory(c.category); setPage(1); }}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${selectedCategory === c.category ? "bg-[#0D7490] text-white" : "bg-card border border-border text-muted-foreground hover:text-foreground"}`}
                >
                  {c.category} ({c.count})
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="pb-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          {loading && (
            <div className="space-y-6">
              {[1, 2, 3].map((i) => (
                <div key={i} className="bg-card border border-border rounded-2xl p-6 animate-pulse">
                  <div className="h-4 bg-muted rounded w-24 mb-3" />
                  <div className="h-6 bg-muted rounded w-3/4 mb-2" />
                  <div className="h-4 bg-muted rounded w-full mb-1" />
                  <div className="h-4 bg-muted rounded w-2/3" />
                </div>
              ))}
            </div>
          )}

          {!loading && posts.length === 0 && (
            <div className="text-center py-16">
              <p className="text-muted-foreground text-lg mb-2">No articles found</p>
              <p className="text-muted-foreground text-sm">Articles are auto-published from market data sources throughout the day.</p>
            </div>
          )}

          {!loading && posts.length > 0 && (
            <div className="space-y-6">
              {posts.map((post) => (
                <Link to={`/blog/${post.slug}`} key={post.id}>
                  <article className="bg-card border border-border rounded-2xl p-4 md:p-6 hover:shadow-lg hover:shadow-[#0D7490]/5 transition-all duration-300 group">
                    <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground mb-3">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${sourceColor(post.source)}`}>
                        {post.source}
                      </span>
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-[#0D7490]/5 text-[#0D7490] rounded-full text-xs font-semibold">
                        {post.category}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5" />
                        {formatDate(post.published_at)}
                      </span>
                    </div>
                    <h2 className="text-lg md:text-xl font-bold text-foreground mb-2 group-hover:text-[#0D7490] transition-colors">
                      {post.title}
                    </h2>
                    {post.excerpt && (
                      <p className="text-muted-foreground leading-relaxed mb-3 line-clamp-2">{post.excerpt}</p>
                    )}
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <User className="w-3.5 h-3.5" /> {post.author}
                      </span>
                      {post.source_url && (
                        <span className="inline-flex items-center gap-1 hover:text-[#0D7490]">
                          <ExternalLink className="w-3.5 h-3.5" /> Source
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1 text-[#0D7490] font-medium">
                        Read more <ArrowRight className="w-3.5 h-3.5" />
                      </span>
                    </div>
                  </article>
                </Link>
              ))}
            </div>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 mt-10">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft className="w-4 h-4" /> Previous
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                Next <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          )}
        </div>
      </section>
    </>
  );
}

// ─── Single Article ──────────────────────────────────────────────────────────

function BlogArticle() {
  const { slug } = useParams<{ slug: string }>();
  const [post, setPost] = useState<BlogPost | null>(null);
  const [loading, setLoading] = useState(true);

  useSEO({
    title: post?.title || "Article",
    description: post?.excerpt || "",
    canonical: `/blog/${slug}`,
  });

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    fetch(`/api/blog/${slug}`)
      .then((r) => { if (!r.ok) throw new Error("Not found"); return r.json(); })
      .then((d) => { setPost(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [slug]);

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 pt-32 pb-20">
        <div className="animate-pulse space-y-4">
          <div className="h-4 bg-muted rounded w-32" />
          <div className="h-8 bg-muted rounded w-3/4" />
          <div className="h-4 bg-muted rounded w-48" />
          <div className="space-y-2 mt-8">
            {[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-4 bg-muted rounded w-full" />)}
          </div>
        </div>
      </div>
    );
  }

  if (!post) {
    return (
      <div className="max-w-3xl mx-auto px-4 pt-32 pb-20 text-center">
        <h1 className="text-2xl font-bold mb-4">Article not found</h1>
        <Link to="/blog" className="text-[#0D7490] hover:underline">Back to blog</Link>
      </div>
    );
  }

  return (
    <>
      <article className="pt-32 pb-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <Link to="/blog" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-[#0D7490] mb-6">
            <ChevronLeft className="w-4 h-4" /> Back to all articles
          </Link>

          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground mb-4">
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${sourceColor(post.source)}`}>
              {post.source}
            </span>
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-[#0D7490]/5 text-[#0D7490] rounded-full text-xs font-semibold">
              {post.category}
            </span>
            <span className="inline-flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5" />
              {formatDate(post.published_at)}
            </span>
          </div>

          <h1 className="text-3xl sm:text-4xl font-bold text-foreground mb-4 leading-tight">{post.title}</h1>

          <div className="flex items-center gap-4 text-sm text-muted-foreground mb-8 pb-6 border-b border-border">
            <span className="inline-flex items-center gap-1.5">
              <User className="w-4 h-4" /> {post.author}
            </span>
            {post.source_url && (
              <a href={post.source_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 hover:text-[#0D7490] transition-colors">
                <ExternalLink className="w-4 h-4" /> View original source
              </a>
            )}
          </div>

          {post.body ? (
            <div className="prose prose-lg dark:prose-invert max-w-none text-foreground leading-relaxed whitespace-pre-wrap">
              {post.body}
            </div>
          ) : post.excerpt ? (
            <div className="prose prose-lg dark:prose-invert max-w-none text-foreground leading-relaxed">
              <p>{post.excerpt}</p>
              {post.source_url && (
                <p className="mt-4">
                  <a href={post.source_url} target="_blank" rel="noopener noreferrer" className="text-[#0D7490] hover:underline inline-flex items-center gap-1">
                    Read the full article at {post.source} <ExternalLink className="w-4 h-4" />
                  </a>
                </p>
              )}
            </div>
          ) : (
            <p className="text-muted-foreground">No content available.</p>
          )}
        </div>
      </article>

      {post.related && post.related.length > 0 && (
        <section className="py-12 bg-muted">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-xl font-bold mb-6">Related articles</h2>
            <div className="space-y-4">
              {post.related.map((r) => (
                <Link to={`/blog/${r.slug}`} key={r.id}>
                  <article className="bg-card border border-border rounded-xl p-4 hover:shadow-md transition-shadow group">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                      <span className={`px-2 py-0.5 rounded-full font-semibold ${sourceColor(r.source)}`}>{r.source}</span>
                      <span>{formatDate(r.published_at)}</span>
                    </div>
                    <h3 className="font-bold text-foreground group-hover:text-[#0D7490] transition-colors">{r.title}</h3>
                    {r.excerpt && <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{r.excerpt}</p>}
                  </article>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}
    </>
  );
}

// ─── Exports ─────────────────────────────────────────────────────────────────

export { BlogList, BlogArticle };
export default BlogList;
