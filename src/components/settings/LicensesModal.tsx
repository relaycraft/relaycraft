import { AnimatePresence, motion } from "framer-motion";
import { Search, Shield, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Virtuoso } from "react-virtuoso";
import licensesData from "../../assets/licenses.json";
import { Button } from "../common/Button";
import { Input } from "../common/Input";

export interface LicenseEntry {
  ecosystem: string;
  name: string;
  version: string;
  license: string;
  repository: string;
}

const allLicenses = licensesData as LicenseEntry[];

export function LicensesModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<"All" | "Node.js" | "Rust" | "Python">("All");

  const filteredLicenses = useMemo(() => {
    return allLicenses.filter((l) => {
      const matchSearch = l.name.toLowerCase().includes(search.toLowerCase());
      const matchTab = activeTab === "All" || l.ecosystem === activeTab;
      return matchSearch && matchTab;
    });
  }, [search, activeTab]);

  const tabs: ("All" | "Node.js" | "Rust" | "Python")[] = ["All", "Node.js", "Rust", "Python"];

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 sm:p-6"
            onClick={onClose}
          >
            {/* Modal */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-2xl h-[75vh] max-h-[600px] bg-card border border-border flex flex-col rounded-2xl shadow-2xl overflow-hidden"
            >
              {/* Header */}
              <div className="flex-none px-6 py-3 border-b border-border/40 bg-muted/20 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-primary/10 text-primary rounded-xl">
                    <Shield className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-foreground tracking-tight">
                      {t("settings.about.licenses.title", "Third-Party Licenses")}
                    </h2>
                    <p className="text-tiny text-muted-foreground mt-0.5">
                      {t(
                        "settings.about.licenses.desc",
                        "Open source software that makes RelayCraft possible.",
                      )}
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="rounded-full h-8 w-8 text-muted-foreground hover:bg-muted/50"
                  onClick={onClose}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>

              {/* Filters */}
              <div className="flex-none p-3 border-b border-border/40 bg-card/50 flex flex-col sm:flex-row gap-3 justify-between items-center">
                <div className="flex bg-muted/30 p-1 rounded-lg w-full sm:w-auto overflow-x-auto no-scrollbar">
                  {tabs.map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={`px-4 py-1.5 text-xs font-medium rounded-md whitespace-nowrap transition-all ${
                        activeTab === tab
                          ? "bg-background text-foreground shadow-sm ring-1 ring-border/50"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                      }`}
                    >
                      {tab === "All" ? t("settings.about.licenses.all", "All") : tab}
                    </button>
                  ))}
                </div>
                <div className="relative w-full sm:w-64">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
                  <Input
                    placeholder={t("common.search", "Search...")}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-9 h-8 text-xs bg-muted/20 border-border/40"
                  />
                </div>
              </div>

              {/* List */}
              <div className="flex-1 min-h-0 bg-muted/10 relative">
                {filteredLicenses.length === 0 ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground">
                    <Shield className="w-12 h-12 mb-3 opacity-20" />
                    <p className="text-sm">{t("common.no_results", "No results found.")}</p>
                  </div>
                ) : (
                  <Virtuoso
                    style={{ height: "100%" }}
                    data={filteredLicenses}
                    itemContent={(_, license) => (
                      <div className="px-6 py-3 border-b border-border/20 hover:bg-muted/30 transition-colors group">
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-mono text-xs font-semibold text-foreground truncate">
                                {license.name}
                              </span>
                              <span className="px-1.5 py-0.5 rounded text-micro font-bold tracking-wider leading-none shrink-0 uppercase border border-border bg-muted/50 text-muted-foreground/80">
                                {license.ecosystem}
                              </span>
                            </div>
                            <div className="flex items-center gap-3 text-xs text-muted-foreground/80">
                              <span className="font-mono bg-muted px-1.5 py-0.5 rounded text-[10px]">
                                v{license.version}
                              </span>
                              {license.repository && license.repository !== "N/A" && (
                                <a
                                  href={license.repository}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="hover:text-primary hover:underline truncate cursor-pointer"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    let url = license.repository;
                                    if (url.startsWith("git+")) url = url.replace(/^git\+/, "");
                                    if (url.startsWith("git://"))
                                      url = url.replace(/^git:\/\//, "https://");
                                    import("@tauri-apps/plugin-opener").then(({ openUrl }) => {
                                      openUrl(url).catch(console.error);
                                    });
                                  }}
                                >
                                  {license.repository
                                    .replace(/^(git\+)?(https?:\/\/)?(www\.)?/, "")
                                    .replace(/\.git$/, "")}
                                </a>
                              )}
                            </div>
                          </div>
                          <div className="shrink-0 text-right mt-0.5">
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-micro font-mono font-medium text-muted-foreground border border-border shadow-sm whitespace-nowrap">
                              {license.license}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                  />
                )}
              </div>
            </motion.div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
