import React, { useEffect, useMemo, useState } from "react";
import {
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  TextInput,
  Platform,
  FlatList,
  Alert,
  ActivityIndicator,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { WebView } from "react-native-webview";
import * as DocumentPicker from "expo-document-picker";
import LegacyMentorApp from "./src/mentor/LegacyMentorApp";
import { LIVE_API_BASE_URL, LOCAL_API_BASE_URL } from "./src/constants";
import {
  createStaffModule,
  getStaffAttendance,
  getStaffAttendanceReport,
  getStaffControlSummary,
  getStaffHomeSummary,
  getStaffModules,
  getStaffModulesManage,
  getStaffSubjects,
  getStaffResultReport,
  getStaffResultCycles,
  getStaffResultRows,
  getStaffStudents,
  getStaffWeeks,
  staffLogin,
  toggleStaffModule,
} from "./src/api";

const ROLE_KEY = "easymentor_mobile_role_v1";
const BASE_KEY = "easymentor_mobile_base_v1";
const LEGACY_MENTOR_BASE_KEY = "easymentor_api_base_url_v1";
const STAFF_SESSION_KEY = "easymentor_mobile_staff_session_v1";
const PAGE_SIZE = 40;

const APP_COLORS = {
  bg: "#eef3fb",
  card: "#ffffff",
  primary: "#0f4d8a",
  primaryDark: "#0b3a66",
  accent: "#1c75bc",
  text: "#0f2137",
  muted: "#5f7287",
  border: "#d6e1ef",
};

const COORDINATOR_TABS = [
  { key: "students", label: "Students", path: "/upload-students/" },
  { key: "attendance", label: "Attendance", path: "/view-attendance/" },
  { key: "results", label: "Results", path: "/view-results/" },
  { key: "control", label: "Control", path: "/control-panel/" },
  { key: "settings", label: "Settings", path: "" },
];

const SUPERADMIN_TABS = [
  { key: "home", label: "Home", path: "/home/" },
  { key: "modules", label: "Modules", path: "/modules/" },
  { key: "students", label: "Students", path: "/upload-students/" },
  { key: "control", label: "Control", path: "/control-panel/" },
  { key: "settings", label: "Settings", path: "" },
];

function RoleGateway({ onSelectRole, apiBaseUrl, setApiBaseUrl }) {
  return (
    <SafeAreaView style={styles.gatewayPage}>
      <StatusBar barStyle="light-content" backgroundColor={APP_COLORS.primary} />
      <View style={styles.gatewayHeader}>
        <Text style={styles.gatewayTitle}>EasyMentor Mobile</Text>
        <Text style={styles.gatewaySub}>Choose your account type</Text>
      </View>

      <View style={styles.gatewayCard}>
        <Text style={styles.gatewaySection}>Server</Text>
        <View style={styles.serverRow}>
          <TouchableOpacity
            style={[styles.serverChip, apiBaseUrl === LOCAL_API_BASE_URL && styles.serverChipActive]}
            onPress={() => setApiBaseUrl(LOCAL_API_BASE_URL)}
          >
            <Text style={[styles.serverChipText, apiBaseUrl === LOCAL_API_BASE_URL && styles.serverChipTextActive]}>
              Local
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.serverChip, apiBaseUrl === LIVE_API_BASE_URL && styles.serverChipActive]}
            onPress={() => setApiBaseUrl(LIVE_API_BASE_URL)}
          >
            <Text style={[styles.serverChipText, apiBaseUrl === LIVE_API_BASE_URL && styles.serverChipTextActive]}>
              Render
            </Text>
          </TouchableOpacity>
        </View>
        <TextInput
          value={apiBaseUrl}
          onChangeText={setApiBaseUrl}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.serverInput}
          placeholder="https://easymentor-web.onrender.com"
        />
      </View>

      <View style={styles.gatewayCard}>
        <Text style={styles.gatewaySection}>Role</Text>
        <TouchableOpacity style={styles.roleButton} onPress={() => onSelectRole("mentor")}>
          <Text style={styles.roleTitle}>Mentor</Text>
          <Text style={styles.roleDesc}>Native calls, reports, and module-aware flow</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.roleButton} onPress={() => onSelectRole("coordinator")}>
          <Text style={styles.roleTitle}>Coordinator</Text>
          <Text style={styles.roleDesc}>Native tab shell: Students, Attendance, Results, Control</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.roleButton} onPress={() => onSelectRole("superadmin")}>
          <Text style={styles.roleTitle}>SuperAdmin</Text>
          <Text style={styles.roleDesc}>Native tab shell: Home, Modules, Students, Control</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function RoleWebTabsApp({ role, apiBaseUrl, onChangeBase, onExit }) {
  const roleTabs = role === "superadmin" ? SUPERADMIN_TABS : COORDINATOR_TABS;
  const [activeTab, setActiveTab] = useState(roleTabs[0].key);
  const [currentUrl, setCurrentUrl] = useState(apiBaseUrl);
  const [reloadKey, setReloadKey] = useState(1);
  const [staffToken, setStaffToken] = useState("");
  const [staffUser, setStaffUser] = useState("");
  const [staffPass, setStaffPass] = useState("");
  const [staffModules, setStaffModules] = useState([]);
  const [staffModuleId, setStaffModuleId] = useState(null);
  const [staffStudents, setStaffStudents] = useState([]);
  const [staffWeeks, setStaffWeeks] = useState([]);
  const [staffWeek, setStaffWeek] = useState(null);
  const [staffAttendanceRows, setStaffAttendanceRows] = useState([]);
  const [staffResultCycles, setStaffResultCycles] = useState([]);
  const [staffResultUploadId, setStaffResultUploadId] = useState(null);
  const [staffResultRows, setStaffResultRows] = useState([]);
  const [staffResultMeta, setStaffResultMeta] = useState(null);
  const [staffSubjects, setStaffSubjects] = useState([]);
  const [resultUploadTest, setResultUploadTest] = useState("T1");
  const [resultUploadSubjectId, setResultUploadSubjectId] = useState("");
  const [resultUploadMode, setResultUploadMode] = useState("subject");
  const [resultUploadFile, setResultUploadFile] = useState(null);
  const [resultUploadMsg, setResultUploadMsg] = useState("");
  const [resultFilter, setResultFilter] = useState("either");
  const [staffControl, setStaffControl] = useState({ week: null, attendance: [], result: [], result_upload: null });
  const [staffHomeStats, setStaffHomeStats] = useState(null);
  const [staffHomeModules, setStaffHomeModules] = useState([]);
  const [staffManageModules, setStaffManageModules] = useState([]);
  const [newModuleName, setNewModuleName] = useState("");
  const [newModuleBatch, setNewModuleBatch] = useState("");
  const [newModuleYear, setNewModuleYear] = useState("FY");
  const [newModuleVariant, setNewModuleVariant] = useState("FY2-CE");
  const [newModuleSem, setNewModuleSem] = useState("Sem-1");
  const [moduleManageMsg, setModuleManageMsg] = useState("");
  const [staffAttendanceReport, setStaffAttendanceReport] = useState([]);
  const [staffResultReport, setStaffResultReport] = useState([]);
  const [attendanceReportFilter, setAttendanceReportFilter] = useState("all");
  const [resultReportFilter, setResultReportFilter] = useState("all");
  const [studentUploadFile, setStudentUploadFile] = useState(null);
  const [weeklyUploadFile, setWeeklyUploadFile] = useState(null);
  const [overallUploadFile, setOverallUploadFile] = useState(null);
  const [uploadRule, setUploadRule] = useState("both");
  const [studentUploadMsg, setStudentUploadMsg] = useState("");
  const [attendanceUploadMsg, setAttendanceUploadMsg] = useState("");
  const [studentFilter, setStudentFilter] = useState("");
  const [staffLoading, setStaffLoading] = useState(false);
  const [studentsPage, setStudentsPage] = useState(1);
  const [studentsHasMore, setStudentsHasMore] = useState(false);
  const [studentsTotal, setStudentsTotal] = useState(0);
  const [resultsPage, setResultsPage] = useState(1);
  const [resultsHasMore, setResultsHasMore] = useState(false);
  const [resultsTotal, setResultsTotal] = useState(0);
  const [studentsRefreshing, setStudentsRefreshing] = useState(false);
  const [studentsLoadingMore, setStudentsLoadingMore] = useState(false);
  const [studentsInitialLoading, setStudentsInitialLoading] = useState(false);
  const [resultsRefreshing, setResultsRefreshing] = useState(false);
  const [resultsLoadingMore, setResultsLoadingMore] = useState(false);
  const [resultsInitialLoading, setResultsInitialLoading] = useState(false);
  const [attendanceRefreshing, setAttendanceRefreshing] = useState(false);
  const [attendanceReportRefreshing, setAttendanceReportRefreshing] = useState(false);
  const [resultReportRefreshing, setResultReportRefreshing] = useState(false);
  const [attendanceVisible, setAttendanceVisible] = useState(PAGE_SIZE);
  const [attendanceReportVisible, setAttendanceReportVisible] = useState(PAGE_SIZE);
  const [resultReportVisible, setResultReportVisible] = useState(PAGE_SIZE);
  const [homeModulesVisible, setHomeModulesVisible] = useState(PAGE_SIZE);
  const [manageModulesVisible, setManageModulesVisible] = useState(PAGE_SIZE);
  const [toastMsg, setToastMsg] = useState("");
  const [toastVisible, setToastVisible] = useState(false);
  const [lastSync, setLastSync] = useState({
    home: null,
    modules: null,
    students: null,
    attendance: null,
    results: null,
    control: null,
  });

  useEffect(() => {
    setCurrentUrl(apiBaseUrl);
  }, [apiBaseUrl]);

  const roleLabel = useMemo(() => {
    if (role === "superadmin") return "SuperAdmin";
    if (role === "coordinator") return "Coordinator";
    return "Portal";
  }, [role]);

  const activeTabConfig = roleTabs.find((t) => t.key === activeTab) || roleTabs[0];
  const targetUrl = activeTabConfig.path
    ? `${currentUrl}${activeTabConfig.path}`
    : currentUrl;
  const touchSync = (key) => {
    setLastSync((prev) => ({ ...prev, [key]: Date.now() }));
  };
  const formatSync = (value) => {
    if (!value) return "Not synced yet";
    const d = new Date(value);
    return `Last synced: ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
  };
  const showToast = (msg) => {
    setToastMsg(msg || "Synced");
    setToastVisible(true);
    setTimeout(() => {
      setToastVisible(false);
    }, 1500);
  };

  const filteredAttendanceReportRows = useMemo(() => {
    if (attendanceReportFilter === "all") return staffAttendanceReport;
    if (attendanceReportFilter === "completed") {
      return staffAttendanceReport.filter((r) => Number(r.completion_percent) >= 100);
    }
    return staffAttendanceReport.filter((r) => Number(r.completion_percent) < 100);
  }, [staffAttendanceReport, attendanceReportFilter]);
  const pagedAttendanceReportRows = useMemo(
    () => filteredAttendanceReportRows.slice(0, attendanceReportVisible),
    [filteredAttendanceReportRows, attendanceReportVisible]
  );

  const filteredResultReportRows = useMemo(() => {
    if (resultReportFilter === "all") return staffResultReport;
    if (resultReportFilter === "completed") {
      return staffResultReport.filter((r) => Number(r.completion_percent) >= 100);
    }
    return staffResultReport.filter((r) => Number(r.completion_percent) < 100);
  }, [staffResultReport, resultReportFilter]);
  const pagedResultReportRows = useMemo(
    () => filteredResultReportRows.slice(0, resultReportVisible),
    [filteredResultReportRows, resultReportVisible]
  );

  const pagedAttendanceRows = useMemo(
    () => staffAttendanceRows.slice(0, attendanceVisible),
    [staffAttendanceRows, attendanceVisible]
  );
  const pagedHomeModules = useMemo(
    () => staffHomeModules.slice(0, homeModulesVisible),
    [staffHomeModules, homeModulesVisible]
  );
  const pagedManageModules = useMemo(
    () => staffManageModules.slice(0, manageModulesVisible),
    [staffManageModules, manageModulesVisible]
  );

  const injectedCss = `
    (function() {
      try {
        var style = document.createElement('style');
        style.innerHTML = 'body{padding-bottom:8px !important;}';
        document.head.appendChild(style);
      } catch(e) {}
    })();
    true;
  `;

  useEffect(() => {
    (async () => {
      const saved = await AsyncStorage.getItem(STAFF_SESSION_KEY);
      if (!saved) return;
      try {
        const parsed = JSON.parse(saved);
        if (parsed.role === role && parsed.token) {
          setStaffToken(parsed.token);
          setStaffUser(parsed.username || "");
        }
      } catch (_) {}
    })();
  }, [role]);

  useEffect(() => {
    if (!staffToken) return;
    (async () => {
      try {
        const mod = await getStaffModules(staffToken, staffModuleId || "");
        setStaffModules(mod.modules || []);
        const selected = mod.selected_module_id || (mod.modules?.[0]?.module_id ?? null);
        setStaffModuleId(selected || null);
      } catch (_) {}
    })();
  }, [staffToken]);

  useEffect(() => {
    if (!staffToken || !staffModuleId) return;
    (async () => {
      try {
        const data = await getStaffSubjects(staffToken, staffModuleId);
        const list = data.subjects || [];
        setStaffSubjects(list);
        if (!resultUploadSubjectId && list.length) {
          setResultUploadSubjectId(String(list[0].id));
        }
      } catch (_) {
        setStaffSubjects([]);
      }
    })();
  }, [staffToken, staffModuleId]);

  useEffect(() => {
    if (!staffToken || !staffModuleId) return;
    (async () => {
      try {
        const data = await getStaffWeeks(staffToken, staffModuleId);
        const weeks = data.weeks || [];
        setStaffWeeks(weeks);
        setStaffWeek(data.latest_week || (weeks.length ? weeks[weeks.length - 1] : null));
      } catch (_) {
        setStaffWeeks([]);
        setStaffWeek(null);
      }
    })();
  }, [staffToken, staffModuleId]);

  useEffect(() => {
    if (!staffToken || !staffModuleId || !staffWeek) return;
    refreshAttendanceRows(false);
  }, [staffToken, staffModuleId, staffWeek]);

  useEffect(() => {
    if (!staffToken || !staffModuleId) return;
    (async () => {
      try {
        const data = await getStaffResultCycles(staffToken, staffModuleId);
        const cycles = data.cycles || [];
        setStaffResultCycles(cycles);
        setStaffResultUploadId(data.latest_upload_id || (cycles[0]?.upload_id ?? null));
      } catch (_) {
        setStaffResultCycles([]);
        setStaffResultUploadId(null);
      }
    })();
  }, [staffToken, staffModuleId]);

  useEffect(() => {
    if (!staffToken || !staffModuleId || !staffResultUploadId) return;
    fetchResultRowsPage(true);
  }, [staffToken, staffModuleId, staffResultUploadId, resultFilter]);

  useEffect(() => {
    if (!staffToken || !staffModuleId) return;
    const t = setTimeout(() => {
      fetchStudentsPage(true);
    }, 250);
    return () => clearTimeout(t);
  }, [staffToken, staffModuleId, studentFilter]);
  useEffect(() => {
    setAttendanceVisible(PAGE_SIZE);
  }, [staffAttendanceRows, staffWeek, staffModuleId]);
  useEffect(() => {
    setAttendanceReportVisible(PAGE_SIZE);
  }, [staffAttendanceReport, attendanceReportFilter, staffWeek, staffModuleId]);
  useEffect(() => {
    setResultReportVisible(PAGE_SIZE);
  }, [staffResultReport, resultReportFilter, staffResultUploadId, staffModuleId]);
  useEffect(() => {
    setHomeModulesVisible(PAGE_SIZE);
  }, [staffHomeModules]);
  useEffect(() => {
    setManageModulesVisible(PAGE_SIZE);
  }, [staffManageModules]);

  useEffect(() => {
    if (!staffToken || role !== "superadmin") return;
    refreshHomeSummary();
  }, [staffToken, role]);

  useEffect(() => {
    if (!staffToken || role !== "superadmin") return;
    refreshManageModules();
  }, [staffToken, role]);

  useEffect(() => {
    if (!staffToken || !staffModuleId) return;
    refreshControlSummary();
  }, [staffToken, staffModuleId, staffWeek, staffResultUploadId]);

  useEffect(() => {
    if (!staffToken || !staffModuleId) return;
    refreshAttendanceReport(false);
  }, [staffToken, staffModuleId, staffWeek]);

  useEffect(() => {
    if (!staffToken || !staffModuleId) return;
    refreshResultReport(false);
  }, [staffToken, staffModuleId, staffResultUploadId]);

  const fetchStudentsPage = async (reset = false) => {
    if (!staffToken || !staffModuleId) return;
    if (reset) {
      if (!staffStudents.length) setStudentsInitialLoading(true);
      setStudentsRefreshing(true);
    } else {
      if (studentsLoadingMore || !studentsHasMore) return;
      setStudentsLoadingMore(true);
    }
    const nextPage = reset ? 1 : studentsPage + 1;
    try {
      const data = await getStaffStudents(staffToken, staffModuleId, {
        page: nextPage,
        page_size: PAGE_SIZE,
        q: studentFilter || "",
      });
      const rows = data.students || [];
      setStaffStudents((prev) => (reset ? rows : [...prev, ...rows]));
      setStudentsPage(nextPage);
      setStudentsHasMore(Boolean(data.has_more));
      setStudentsTotal(Number(data.total || 0));
      touchSync("students");
    } catch (_) {
      if (reset) {
        setStaffStudents([]);
        setStudentsTotal(0);
      }
      setStudentsHasMore(false);
    } finally {
      if (reset) {
        setStudentsRefreshing(false);
        setStudentsInitialLoading(false);
      } else {
        setStudentsLoadingMore(false);
      }
    }
  };

  const fetchResultRowsPage = async (reset = false) => {
    if (!staffToken || !staffModuleId || !staffResultUploadId) return;
    if (reset) {
      if (!staffResultRows.length) setResultsInitialLoading(true);
      setResultsRefreshing(true);
    } else {
      if (resultsLoadingMore || !resultsHasMore) return;
      setResultsLoadingMore(true);
    }
    const nextPage = reset ? 1 : resultsPage + 1;
    const failFilter = resultFilter === "all" ? "all" : resultFilter;
    try {
      const data = await getStaffResultRows(staffToken, staffResultUploadId, staffModuleId, {
        page: nextPage,
        page_size: PAGE_SIZE,
        fail_filter: failFilter,
      });
      const rows = data.rows || [];
      setStaffResultRows((prev) => (reset ? rows : [...prev, ...rows]));
      setStaffResultMeta(data.upload || null);
      setResultsPage(nextPage);
      setResultsHasMore(Boolean(data.has_more));
      setResultsTotal(Number(data.total || 0));
      touchSync("results");
    } catch (_) {
      if (reset) {
        setStaffResultRows([]);
        setResultsTotal(0);
      }
      setResultsHasMore(false);
    } finally {
      if (reset) {
        setResultsRefreshing(false);
        setResultsInitialLoading(false);
      } else {
        setResultsLoadingMore(false);
      }
    }
  };

  const refreshAttendanceRows = async (showPull = false) => {
    if (!staffToken || !staffModuleId || !staffWeek) return;
    if (showPull) setAttendanceRefreshing(true);
    try {
      const data = await getStaffAttendance(staffToken, staffWeek, staffModuleId);
      setStaffAttendanceRows(data.rows || []);
      touchSync("attendance");
    } catch (_) {
      setStaffAttendanceRows([]);
    } finally {
      if (showPull) setAttendanceRefreshing(false);
    }
  };

  const refreshAttendanceReport = async (showPull = false) => {
    if (!staffToken || !staffModuleId) return;
    if (showPull) setAttendanceReportRefreshing(true);
    try {
      const data = await getStaffAttendanceReport(staffToken, staffModuleId, staffWeek || "");
      setStaffAttendanceReport(data.rows || []);
      touchSync("attendance");
    } catch (_) {
      setStaffAttendanceReport([]);
    } finally {
      if (showPull) setAttendanceReportRefreshing(false);
    }
  };

  const refreshResultReport = async (showPull = false) => {
    if (!staffToken || !staffModuleId) return;
    if (showPull) setResultReportRefreshing(true);
    try {
      const data = await getStaffResultReport(staffToken, staffModuleId, staffResultUploadId || "");
      setStaffResultReport(data.rows || []);
      touchSync("results");
    } catch (_) {
      setStaffResultReport([]);
    } finally {
      if (showPull) setResultReportRefreshing(false);
    }
  };

  const refreshHomeSummary = async () => {
    if (!staffToken || role !== "superadmin") return;
    try {
      const data = await getStaffHomeSummary(staffToken);
      setStaffHomeStats(data.stats || null);
      setStaffHomeModules(data.modules || []);
      touchSync("home");
    } catch (_) {
      setStaffHomeStats(null);
      setStaffHomeModules([]);
    }
  };

  const refreshManageModules = async () => {
    if (!staffToken || role !== "superadmin") return;
    try {
      const data = await getStaffModulesManage(staffToken);
      setStaffManageModules(data.modules || []);
      touchSync("modules");
    } catch (_) {
      setStaffManageModules([]);
    }
  };

  const refreshControlSummary = async () => {
    if (!staffToken || !staffModuleId) return;
    try {
      const data = await getStaffControlSummary(
        staffToken,
        staffModuleId,
        staffWeek || "",
        staffResultUploadId || ""
      );
      setStaffControl({
        week: data.week ?? null,
        attendance: data.attendance || [],
        result: data.result || [],
        result_upload: data.result_upload || null,
      });
      touchSync("control");
    } catch (_) {
      setStaffControl({ week: null, attendance: [], result: [], result_upload: null });
    }
  };

  const doStaffLogin = async () => {
    if (!staffUser.trim() || !staffPass.trim()) return;
    setStaffLoading(true);
    try {
      const data = await staffLogin(staffUser.trim(), staffPass);
      setStaffToken(data.token);
      await AsyncStorage.setItem(
        STAFF_SESSION_KEY,
        JSON.stringify({ role, username: staffUser.trim(), token: data.token })
      );
    } finally {
      setStaffLoading(false);
    }
  };

  const clearStaffSession = async () => {
    setStaffToken("");
    setStaffPass("");
    setStaffModules([]);
    setStaffStudents([]);
    setStaffWeeks([]);
    setStaffAttendanceRows([]);
    setStaffResultCycles([]);
    setStaffResultRows([]);
    setStaffResultUploadId(null);
    setStaffResultMeta(null);
    setStudentsPage(1);
    setStudentsHasMore(false);
    setStudentsTotal(0);
    setStudentsRefreshing(false);
    setStudentsLoadingMore(false);
    setStudentsInitialLoading(false);
    setResultsPage(1);
    setResultsHasMore(false);
    setResultsTotal(0);
    setResultsRefreshing(false);
    setResultsLoadingMore(false);
    setResultsInitialLoading(false);
    setAttendanceRefreshing(false);
    setAttendanceReportRefreshing(false);
    setResultReportRefreshing(false);
    setStaffSubjects([]);
    setResultUploadFile(null);
    setResultUploadMsg("");
    setStaffControl({ week: null, attendance: [], result: [], result_upload: null });
    setStaffAttendanceReport([]);
    setStaffResultReport([]);
    setStaffHomeStats(null);
    setStaffHomeModules([]);
    setStaffManageModules([]);
    setLastSync({
      home: null,
      modules: null,
      students: null,
      attendance: null,
      results: null,
      control: null,
    });
    setModuleManageMsg("");
    setStaffModuleId(null);
    setStaffWeek(null);
    await AsyncStorage.removeItem(STAFF_SESSION_KEY);
  };

  const doCreateModule = async () => {
    if (!newModuleName.trim() || !newModuleBatch.trim()) {
      Alert.alert("Required", "Module name and batch are required.");
      return;
    }
    setStaffLoading(true);
    try {
      const res = await createStaffModule(staffToken, {
        name: newModuleName.trim(),
        academic_batch: newModuleBatch.trim(),
        year_level: newModuleYear,
        variant: newModuleVariant,
        semester: newModuleSem,
      });
      setModuleManageMsg(res.msg || "Module created.");
      setNewModuleName("");
      const [mods, home] = await Promise.all([
        getStaffModulesManage(staffToken),
        getStaffHomeSummary(staffToken),
      ]);
      setStaffManageModules(mods.modules || []);
      setStaffHomeStats(home.stats || null);
      setStaffHomeModules(home.modules || []);
      touchSync("modules");
      touchSync("home");
    } catch (err) {
      Alert.alert("Create failed", String(err.message || err));
    } finally {
      setStaffLoading(false);
    }
  };

  const doToggleModule = async (moduleId, isActive) => {
    const action = isActive ? "archive" : "activate";
    setStaffLoading(true);
    try {
      const res = await toggleStaffModule(staffToken, moduleId, action);
      setModuleManageMsg(res.msg || "Updated.");
      const [mods, home] = await Promise.all([
        getStaffModulesManage(staffToken),
        getStaffHomeSummary(staffToken),
      ]);
      setStaffManageModules(mods.modules || []);
      setStaffHomeStats(home.stats || null);
      setStaffHomeModules(home.modules || []);
      touchSync("modules");
      touchSync("home");
    } catch (err) {
      Alert.alert("Update failed", String(err.message || err));
    } finally {
      setStaffLoading(false);
    }
  };

  const pickExcelFile = async (setter) => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: [
          "application/vnd.ms-excel",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "application/octet-stream",
        ],
        copyToCacheDirectory: true,
      });
      if (res?.canceled) return;
      const file = res?.assets?.[0];
      if (file) setter(file);
    } catch (_) {}
  };

  const uploadMultipart = async (path, fields = {}, files = {}) => {
    if (!staffToken) throw new Error("Unauthorized");
    const form = new FormData();
    Object.entries(fields).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v) !== "") {
        form.append(k, String(v));
      }
    });
    Object.entries(files).forEach(([k, f]) => {
      if (!f) return;
      form.append(k, {
        uri: f.uri,
        name: f.name || `${k}.xlsx`,
        type: f.mimeType || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
    });

    const response = await fetch(`${currentUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${staffToken}`,
        "X-Module-Id": String(staffModuleId || ""),
      },
      body: form,
    });
    const data = await response.json();
    if (!response.ok || data.ok === false) {
      throw new Error(data.msg || "Upload failed");
    }
    return data;
  };

  const doStudentUpload = async () => {
    if (!studentUploadFile) {
      Alert.alert("Select file", "Please select Student Master Excel first.");
      return;
    }
    setStaffLoading(true);
    try {
      const data = await uploadMultipart("/api/mobile/staff/upload-students/", {}, { file: studentUploadFile });
      setStudentUploadMsg(data.msg || "Upload done.");
      const sdata = await getStaffStudents(staffToken, staffModuleId);
      setStaffStudents(sdata.students || []);
    } catch (err) {
      Alert.alert("Upload failed", String(err.message || err));
    } finally {
      setStaffLoading(false);
    }
  };

  const doStudentClear = async () => {
    Alert.alert(
      "Confirm Delete",
      "Delete Student Master data for selected module?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setStaffLoading(true);
            try {
              const response = await fetch(`${currentUrl}/api/mobile/staff/clear-students/`, {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${staffToken}`,
                  "X-Module-Id": String(staffModuleId || ""),
                },
              });
              const data = await response.json();
              if (!response.ok || data.ok === false) throw new Error(data.msg || "Delete failed");
              setStudentUploadMsg(data.msg || "Deleted.");
              setStaffStudents([]);
            } catch (err) {
              Alert.alert("Delete failed", String(err.message || err));
            } finally {
              setStaffLoading(false);
            }
          },
        },
      ]
    );
  };

  const doAttendanceUpload = async () => {
    if (!staffWeek) {
      Alert.alert("Select week", "Please select week first.");
      return;
    }
    if (!weeklyUploadFile) {
      Alert.alert("Select file", "Please select weekly attendance file first.");
      return;
    }
    setStaffLoading(true);
    try {
      const files = {
        weekly_file: weeklyUploadFile,
        overall_file: staffWeek === 1 ? null : overallUploadFile,
      };
      const data = await uploadMultipart(
        "/api/mobile/staff/upload-attendance/",
        { week: staffWeek, rule: uploadRule },
        files
      );
      setAttendanceUploadMsg(data.msg || "Attendance uploaded.");
      const [attRows, rep] = await Promise.all([
        getStaffAttendance(staffToken, staffWeek, staffModuleId),
        getStaffAttendanceReport(staffToken, staffModuleId, staffWeek),
      ]);
      setStaffAttendanceRows(attRows.rows || []);
      setStaffAttendanceReport(rep.rows || []);
      touchSync("attendance");
    } catch (err) {
      Alert.alert("Upload failed", String(err.message || err));
    } finally {
      setStaffLoading(false);
    }
  };

  const doResultUpload = async () => {
    if (!resultUploadFile) {
      Alert.alert("Select file", "Please select result sheet first.");
      return;
    }
    const isAllExams = resultUploadTest === "ALL_EXAMS";
    if (!isAllExams && !resultUploadSubjectId) {
      Alert.alert("Select subject", "Please select subject.");
      return;
    }
    setStaffLoading(true);
    try {
      const data = await uploadMultipart(
        "/api/mobile/staff/upload-results/",
        {
          test_name: resultUploadTest,
          subject_id: isAllExams ? "ALL" : resultUploadSubjectId,
          upload_mode: isAllExams ? "compiled" : resultUploadMode,
          bulk_confirm: isAllExams ? "yes" : "",
        },
        { result_file: resultUploadFile }
      );
      setResultUploadMsg(data.msg || "Result upload completed.");
      const [cycles, rows, report] = await Promise.all([
        getStaffResultCycles(staffToken, staffModuleId),
        getStaffResultRows(staffToken, data.upload_id || "", staffModuleId, {
          page: 1,
          page_size: PAGE_SIZE,
          fail_filter: resultFilter,
        }),
        getStaffResultReport(staffToken, staffModuleId, data.upload_id || ""),
      ]);
      setStaffResultCycles(cycles.cycles || []);
      setStaffResultUploadId(data.upload_id || cycles.latest_upload_id || null);
      setStaffResultRows(rows.rows || []);
      setStaffResultMeta(rows.upload || null);
      setResultsPage(Number(rows.page || 1));
      setResultsHasMore(Boolean(rows.has_more));
      setResultsTotal(Number(rows.total || 0));
      setStaffResultReport(report.rows || []);
      touchSync("results");
    } catch (err) {
      Alert.alert("Upload failed", String(err.message || err));
    } finally {
      setStaffLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.portalPage}>
      <StatusBar barStyle="light-content" backgroundColor={APP_COLORS.primary} />

      <View style={styles.portalHeader}>
        <View>
          <Text style={styles.portalTitle}>{roleLabel} Mobile</Text>
          <Text style={styles.portalSub}>Login with your existing {roleLabel} account</Text>
        </View>
        <TouchableOpacity style={styles.exitBtn} onPress={onExit}>
          <Text style={styles.exitBtnText}>Switch</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.portalBody}>
        {activeTab === "home" ? (
          !staffToken ? (
            <View style={styles.infoPanel}>
              <Text style={styles.infoTitle}>SuperAdmin Login</Text>
              <TextInput
                value={staffUser}
                onChangeText={setStaffUser}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="Username"
                style={styles.serverInput}
              />
              <TextInput
                value={staffPass}
                onChangeText={setStaffPass}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="Password"
                secureTextEntry
                style={[styles.serverInput, { marginTop: 8 }]}
              />
              <TouchableOpacity style={styles.applyBtn} onPress={doStaffLogin} disabled={staffLoading}>
                <Text style={styles.applyBtnText}>{staffLoading ? "Please wait..." : "Login"}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.studentsWrap}>
              <Text style={styles.infoTitle}>SuperAdmin Home</Text>
              <View style={styles.syncRow}>
                <Text style={styles.syncText}>{formatSync(lastSync.home)}</Text>
                <TouchableOpacity
                  style={styles.syncBtn}
                  onPress={async () => {
                    await refreshHomeSummary();
                    showToast("Synced");
                  }}
                  disabled={staffLoading}
                >
                  <Text style={styles.syncBtnText}>Sync now</Text>
                </TouchableOpacity>
              </View>
              {staffHomeStats ? (
                <View style={styles.statsGrid}>
                  <View style={styles.statCard}>
                    <Text style={styles.statLabel}>Coordinators</Text>
                    <Text style={styles.statValue}>{staffHomeStats.total_coordinators}</Text>
                  </View>
                  <View style={styles.statCard}>
                    <Text style={styles.statLabel}>Modules</Text>
                    <Text style={styles.statValue}>{staffHomeStats.total_modules}</Text>
                  </View>
                  <View style={styles.statCard}>
                    <Text style={styles.statLabel}>Mentors</Text>
                    <Text style={styles.statValue}>{staffHomeStats.total_mentors}</Text>
                  </View>
                  <View style={styles.statCard}>
                    <Text style={styles.statLabel}>Students</Text>
                    <Text style={styles.statValue}>{staffHomeStats.total_students}</Text>
                  </View>
                </View>
              ) : null}
              <Text style={[styles.infoTitle, { fontSize: 15, marginTop: 8 }]}>Module Snapshot</Text>
              <FlatList
                data={pagedHomeModules}
                keyExtractor={(m) => String(m.id)}
                initialNumToRender={12}
                windowSize={8}
                renderItem={({ item }) => (
                  <View style={styles.studentCard}>
                    <Text style={styles.studentName}>{item.name}</Text>
                    <Text style={styles.studentMeta}>
                      {item.variant} | {item.semester} | Batch {item.batch}
                    </Text>
                    <Text style={styles.studentMeta}>
                      Students: {item.students} | Mentors: {item.mentors} | Coordinators: {item.coordinators}
                    </Text>
                  </View>
                )}
              />
              {pagedHomeModules.length < staffHomeModules.length ? (
                <TouchableOpacity style={styles.loadMoreBtn} onPress={() => setHomeModulesVisible((n) => n + PAGE_SIZE)}>
                  <Text style={styles.loadMoreText}>Load More</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          )
        ) : activeTab === "modules" ? (
          !staffToken ? (
            <View style={styles.infoPanel}>
              <Text style={styles.infoTitle}>SuperAdmin Login</Text>
              <TextInput
                value={staffUser}
                onChangeText={setStaffUser}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="Username"
                style={styles.serverInput}
              />
              <TextInput
                value={staffPass}
                onChangeText={setStaffPass}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="Password"
                secureTextEntry
                style={[styles.serverInput, { marginTop: 8 }]}
              />
              <TouchableOpacity style={styles.applyBtn} onPress={doStaffLogin} disabled={staffLoading}>
                <Text style={styles.applyBtnText}>{staffLoading ? "Please wait..." : "Login"}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.studentsWrap}>
              <Text style={styles.infoTitle}>Manage Modules</Text>
              <View style={styles.syncRow}>
                <Text style={styles.syncText}>{formatSync(lastSync.modules)}</Text>
                <TouchableOpacity
                  style={styles.syncBtn}
                  onPress={async () => {
                    await refreshManageModules();
                    showToast("Synced");
                  }}
                  disabled={staffLoading}
                >
                  <Text style={styles.syncBtnText}>Sync now</Text>
                </TouchableOpacity>
              </View>
              <TextInput
                value={newModuleName}
                onChangeText={setNewModuleName}
                placeholder="Module name"
                style={[styles.serverInput, { marginBottom: 8 }]}
              />
              <TextInput
                value={newModuleBatch}
                onChangeText={setNewModuleBatch}
                placeholder="Academic batch (e.g. 2026-29)"
                style={[styles.serverInput, { marginBottom: 8 }]}
              />
              <View style={styles.filterRow}>
                {["FY", "SY", "TY", "LY"].map((yy) => (
                  <TouchableOpacity key={yy} style={[styles.filterBtn, newModuleYear === yy && styles.filterBtnActive]} onPress={() => setNewModuleYear(yy)}>
                    <Text style={[styles.filterBtnText, newModuleYear === yy && styles.filterBtnTextActive]}>{yy}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.filterRow}>
                {["FY1", "FY2-CE", "FY2-Non CE", "FY3", "FY4", "FY5"].map((vv) => (
                  <TouchableOpacity key={vv} style={[styles.filterBtn, newModuleVariant === vv && styles.filterBtnActive]} onPress={() => setNewModuleVariant(vv)}>
                    <Text style={[styles.filterBtnText, newModuleVariant === vv && styles.filterBtnTextActive]}>{vv}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.filterRow}>
                {["Sem-1", "Sem-2"].map((ss) => (
                  <TouchableOpacity key={ss} style={[styles.filterBtn, newModuleSem === ss && styles.filterBtnActive]} onPress={() => setNewModuleSem(ss)}>
                    <Text style={[styles.filterBtnText, newModuleSem === ss && styles.filterBtnTextActive]}>{ss}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TouchableOpacity style={styles.applyBtn} onPress={doCreateModule} disabled={staffLoading}>
                <Text style={styles.applyBtnText}>{staffLoading ? "Please wait..." : "Create Module"}</Text>
              </TouchableOpacity>
              {moduleManageMsg ? <Text style={styles.uploadMsg}>{moduleManageMsg}</Text> : null}
              <FlatList
                data={pagedManageModules}
                keyExtractor={(m) => String(m.id)}
                initialNumToRender={12}
                windowSize={8}
                renderItem={({ item }) => (
                  <View style={styles.studentCard}>
                    <Text style={styles.studentName}>{item.name}</Text>
                    <Text style={styles.studentMeta}>
                      {item.variant} | {item.semester} | Batch {item.batch}
                    </Text>
                    <View style={styles.actionRow}>
                      <TouchableOpacity
                        style={item.is_active ? styles.smallDanger : styles.smallBtnPrimary}
                        onPress={() => doToggleModule(item.id, item.is_active)}
                      >
                        <Text style={item.is_active ? styles.smallDangerText : styles.smallBtnPrimaryText}>
                          {item.is_active ? "Archive" : "Activate"}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              />
              {pagedManageModules.length < staffManageModules.length ? (
                <TouchableOpacity style={styles.loadMoreBtn} onPress={() => setManageModulesVisible((n) => n + PAGE_SIZE)}>
                  <Text style={styles.loadMoreText}>Load More</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          )
        ) : activeTab === "students" ? (
          !staffToken ? (
            <View style={styles.infoPanel}>
              <Text style={styles.infoTitle}>Native Students Login</Text>
              <TextInput
                value={staffUser}
                onChangeText={setStaffUser}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="Username"
                style={styles.serverInput}
              />
              <TextInput
                value={staffPass}
                onChangeText={setStaffPass}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="Password"
                secureTextEntry
                style={[styles.serverInput, { marginTop: 8 }]}
              />
              <TouchableOpacity style={styles.applyBtn} onPress={doStaffLogin} disabled={staffLoading}>
                <Text style={styles.applyBtnText}>{staffLoading ? "Please wait..." : "Login"}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.studentsWrap}>
              <View style={styles.studentsTopRow}>
                <Text style={styles.infoTitle}>Students ({studentsTotal})</Text>
                <TouchableOpacity style={styles.smallDanger} onPress={clearStaffSession}>
                  <Text style={styles.smallDangerText}>Logout</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.syncRow}>
                <Text style={styles.syncText}>{formatSync(lastSync.students)}</Text>
                <TouchableOpacity
                  style={styles.syncBtn}
                  onPress={async () => {
                    await fetchStudentsPage(true);
                    showToast("Synced");
                  }}
                  disabled={staffLoading}
                >
                  <Text style={styles.syncBtnText}>Sync now</Text>
                </TouchableOpacity>
              </View>
              <FlatList
                horizontal
                showsHorizontalScrollIndicator={false}
                data={staffModules}
                keyExtractor={(m) => String(m.module_id)}
                style={{ maxHeight: 44, marginBottom: 8 }}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[
                      styles.moduleChip,
                      staffModuleId === item.module_id && styles.moduleChipActive,
                    ]}
                    onPress={() => setStaffModuleId(item.module_id)}
                  >
                    <Text
                      style={[
                        styles.moduleChipText,
                        staffModuleId === item.module_id && styles.moduleChipTextActive,
                      ]}
                    >
                      {item.name}
                    </Text>
                  </TouchableOpacity>
                )}
              />
              <View style={styles.actionRow}>
                <TouchableOpacity style={styles.smallBtn} onPress={() => pickExcelFile(setStudentUploadFile)}>
                  <Text style={styles.smallBtnText}>
                    {studentUploadFile ? `File: ${studentUploadFile.name}` : "Choose File"}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.smallBtnPrimary} onPress={doStudentUpload} disabled={staffLoading}>
                  <Text style={styles.smallBtnPrimaryText}>Upload</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.smallDanger} onPress={doStudentClear} disabled={staffLoading}>
                  <Text style={styles.smallDangerText}>Delete Data</Text>
                </TouchableOpacity>
              </View>
              {studentUploadMsg ? <Text style={styles.uploadMsg}>{studentUploadMsg}</Text> : null}
              <TextInput
                value={studentFilter}
                onChangeText={setStudentFilter}
                placeholder="Filter students..."
                style={[styles.serverInput, { marginBottom: 8 }]}
              />
              {studentsInitialLoading && !staffStudents.length ? (
                <View>
                  {[0, 1, 2].map((n) => (
                    <View style={styles.skeletonCard} key={`student-skeleton-${n}`}>
                      <View style={[styles.skeletonLine, { width: "65%" }]} />
                      <View style={[styles.skeletonLine, { width: "50%" }]} />
                      <View style={[styles.skeletonLine, { width: "45%" }]} />
                    </View>
                  ))}
                </View>
              ) : (
                <FlatList
                  data={staffStudents}
                  keyExtractor={(s, idx) => `${s.enrollment || "x"}-${idx}`}
                  initialNumToRender={16}
                  windowSize={9}
                  refreshing={studentsRefreshing}
                  onRefresh={() => fetchStudentsPage(true)}
                  onEndReachedThreshold={0.4}
                  onEndReached={() => fetchStudentsPage(false)}
                  ListFooterComponent={
                    studentsLoadingMore ? (
                      <View style={styles.listFooter}>
                        <ActivityIndicator color={APP_COLORS.accent} size="small" />
                      </View>
                    ) : !studentsHasMore && staffStudents.length ? (
                      <Text style={styles.listEndText}>No more records</Text>
                    ) : null
                  }
                  renderItem={({ item }) => (
                    <View style={styles.studentCard}>
                      <Text style={styles.studentName}>
                        {item.roll_no || "-"} | {item.name}
                      </Text>
                      <Text style={styles.studentMeta}>{item.enrollment} | {item.branch || "-"}</Text>
                      <Text style={styles.studentMeta}>Mentor: {item.mentor || "-"}</Text>
                      <Text style={styles.studentMeta}>Student: {item.student_mobile || "-"}</Text>
                      <Text style={styles.studentMeta}>Father: {item.father_mobile || "-"}</Text>
                    </View>
                  )}
                />
              )}
            </View>
          )
        ) : activeTab === "attendance" ? (
          !staffToken ? (
            <View style={styles.infoPanel}>
              <Text style={styles.infoTitle}>Native Attendance Login</Text>
              <TextInput
                value={staffUser}
                onChangeText={setStaffUser}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="Username"
                style={styles.serverInput}
              />
              <TextInput
                value={staffPass}
                onChangeText={setStaffPass}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="Password"
                secureTextEntry
                style={[styles.serverInput, { marginTop: 8 }]}
              />
              <TouchableOpacity style={styles.applyBtn} onPress={doStaffLogin} disabled={staffLoading}>
                <Text style={styles.applyBtnText}>{staffLoading ? "Please wait..." : "Login"}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.studentsWrap}>
              <View style={styles.studentsTopRow}>
                <Text style={styles.infoTitle}>Attendance (Week {staffWeek || "-"})</Text>
              </View>
              <View style={styles.syncRow}>
                <Text style={styles.syncText}>{formatSync(lastSync.attendance)}</Text>
                <TouchableOpacity
                  style={styles.syncBtn}
                  onPress={async () => {
                    await Promise.all([refreshAttendanceRows(true), refreshAttendanceReport(true)]);
                    showToast("Synced");
                  }}
                  disabled={staffLoading}
                >
                  <Text style={styles.syncBtnText}>Sync now</Text>
                </TouchableOpacity>
              </View>
              <FlatList
                horizontal
                showsHorizontalScrollIndicator={false}
                data={staffModules}
                keyExtractor={(m) => String(m.module_id)}
                style={{ maxHeight: 44, marginBottom: 8 }}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[
                      styles.moduleChip,
                      staffModuleId === item.module_id && styles.moduleChipActive,
                    ]}
                    onPress={() => setStaffModuleId(item.module_id)}
                  >
                    <Text
                      style={[
                        styles.moduleChipText,
                        staffModuleId === item.module_id && styles.moduleChipTextActive,
                      ]}
                    >
                      {item.name}
                    </Text>
                  </TouchableOpacity>
                )}
              />
              <FlatList
                horizontal
                showsHorizontalScrollIndicator={false}
                data={staffWeeks}
                keyExtractor={(w, idx) => `${w}-${idx}`}
                style={{ maxHeight: 44, marginBottom: 8 }}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[styles.moduleChip, staffWeek === item && styles.moduleChipActive]}
                    onPress={() => setStaffWeek(item)}
                  >
                    <Text style={[styles.moduleChipText, staffWeek === item && styles.moduleChipTextActive]}>
                      Week {item}
                    </Text>
                  </TouchableOpacity>
                )}
              />
              <View style={styles.filterRow}>
                <TouchableOpacity style={[styles.filterBtn, uploadRule === "both" && styles.filterBtnActive]} onPress={() => setUploadRule("both")}>
                  <Text style={[styles.filterBtnText, uploadRule === "both" && styles.filterBtnTextActive]}>Both &lt;80</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.filterBtn, uploadRule === "week" && styles.filterBtnActive]} onPress={() => setUploadRule("week")}>
                  <Text style={[styles.filterBtnText, uploadRule === "week" && styles.filterBtnTextActive]}>Week &lt;80</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.filterBtn, uploadRule === "overall" && styles.filterBtnActive]} onPress={() => setUploadRule("overall")}>
                  <Text style={[styles.filterBtnText, uploadRule === "overall" && styles.filterBtnTextActive]}>Overall &lt;80</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.actionRow}>
                <TouchableOpacity style={styles.smallBtn} onPress={() => pickExcelFile(setWeeklyUploadFile)}>
                  <Text style={styles.smallBtnText}>
                    {weeklyUploadFile ? `Weekly: ${weeklyUploadFile.name}` : "Weekly File"}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.smallBtn} onPress={() => pickExcelFile(setOverallUploadFile)}>
                  <Text style={styles.smallBtnText}>
                    {overallUploadFile ? `Overall: ${overallUploadFile.name}` : "Overall File"}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.smallBtnPrimary} onPress={doAttendanceUpload} disabled={staffLoading}>
                  <Text style={styles.smallBtnPrimaryText}>Upload</Text>
                </TouchableOpacity>
              </View>
              {attendanceUploadMsg ? <Text style={styles.uploadMsg}>{attendanceUploadMsg}</Text> : null}
              <FlatList
                data={pagedAttendanceRows}
                keyExtractor={(r, idx) => `${r.enrollment || "x"}-${idx}`}
                initialNumToRender={16}
                windowSize={9}
                refreshing={attendanceRefreshing}
                onRefresh={() => refreshAttendanceRows(true)}
                renderItem={({ item }) => {
                  const wk = Number(item.week_percentage);
                  const ov = Number(item.overall_percentage);
                  const wkLow = !Number.isNaN(wk) && wk < 80;
                  const ovLow = !Number.isNaN(ov) && ov < 80;
                  return (
                    <View style={styles.studentCard}>
                      <Text style={styles.studentName}>
                        {item.roll_no || "-"} | {item.name}
                      </Text>
                      <Text style={styles.studentMeta}>{item.enrollment} | Mentor: {item.mentor || "-"}</Text>
                      <Text style={[styles.studentMeta, wkLow && styles.lowText]}>
                        Week %: {item.week_percentage ?? "-"}
                      </Text>
                      <Text style={[styles.studentMeta, ovLow && styles.lowText]}>
                        Overall %: {item.overall_percentage ?? "-"}
                      </Text>
                      <Text style={styles.studentMeta}>
                        Call required: {item.call_required ? "Yes" : "No"} | Status: {item.call_status || "Pending"}
                      </Text>
                    </View>
                  );
                }}
              />
              {pagedAttendanceRows.length < staffAttendanceRows.length ? (
                <TouchableOpacity style={styles.loadMoreBtn} onPress={() => setAttendanceVisible((n) => n + PAGE_SIZE)}>
                  <Text style={styles.loadMoreText}>Load More</Text>
                </TouchableOpacity>
              ) : null}
              <Text style={[styles.infoTitle, { fontSize: 15, marginTop: 8 }]}>Attendance Report (Mentor-wise)</Text>
              <View style={styles.filterRow}>
                <TouchableOpacity style={[styles.filterBtn, attendanceReportFilter === "all" && styles.filterBtnActive]} onPress={() => setAttendanceReportFilter("all")}>
                  <Text style={[styles.filterBtnText, attendanceReportFilter === "all" && styles.filterBtnTextActive]}>All</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.filterBtn, attendanceReportFilter === "completed" && styles.filterBtnActive]} onPress={() => setAttendanceReportFilter("completed")}>
                  <Text style={[styles.filterBtnText, attendanceReportFilter === "completed" && styles.filterBtnTextActive]}>Completed</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.filterBtn, attendanceReportFilter === "pending" && styles.filterBtnActive]} onPress={() => setAttendanceReportFilter("pending")}>
                  <Text style={[styles.filterBtnText, attendanceReportFilter === "pending" && styles.filterBtnTextActive]}>Pending</Text>
                </TouchableOpacity>
              </View>
              <FlatList
                data={pagedAttendanceReportRows}
                keyExtractor={(r, idx) => `${r.mentor}-${idx}`}
                initialNumToRender={12}
                windowSize={8}
                refreshing={attendanceReportRefreshing}
                onRefresh={() => refreshAttendanceReport(true)}
                renderItem={({ item }) => (
                  <View style={styles.studentCard}>
                    <Text style={styles.studentName}>{item.mentor}</Text>
                    <Text style={styles.studentMeta}>
                      Students: {item.students} | Need: {item.need_call} | Done: {item.done}
                    </Text>
                    <Text style={styles.studentMeta}>
                      Received: {item.received} | Not Received: {item.not_received} | Msg: {item.msg_sent}
                    </Text>
                    <Text style={[styles.studentMeta, Number(item.completion_percent) < 100 && styles.lowText]}>
                      Completion: {item.completion_percent}%
                    </Text>
                  </View>
                )}
              />
              {pagedAttendanceReportRows.length < filteredAttendanceReportRows.length ? (
                <TouchableOpacity style={styles.loadMoreBtn} onPress={() => setAttendanceReportVisible((n) => n + PAGE_SIZE)}>
                  <Text style={styles.loadMoreText}>Load More</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          )
        ) : activeTab === "results" ? (
          !staffToken ? (
            <View style={styles.infoPanel}>
              <Text style={styles.infoTitle}>Native Results Login</Text>
              <TextInput
                value={staffUser}
                onChangeText={setStaffUser}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="Username"
                style={styles.serverInput}
              />
              <TextInput
                value={staffPass}
                onChangeText={setStaffPass}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="Password"
                secureTextEntry
                style={[styles.serverInput, { marginTop: 8 }]}
              />
              <TouchableOpacity style={styles.applyBtn} onPress={doStaffLogin} disabled={staffLoading}>
                <Text style={styles.applyBtnText}>{staffLoading ? "Please wait..." : "Login"}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.studentsWrap}>
              <View style={styles.studentsTopRow}>
                <Text style={styles.infoTitle}>
                  Results ({resultsTotal})
                </Text>
              </View>
              <View style={styles.syncRow}>
                <Text style={styles.syncText}>{formatSync(lastSync.results)}</Text>
                <TouchableOpacity
                  style={styles.syncBtn}
                  onPress={async () => {
                    await Promise.all([fetchResultRowsPage(true), refreshResultReport(true)]);
                    showToast("Synced");
                  }}
                  disabled={staffLoading}
                >
                  <Text style={styles.syncBtnText}>Sync now</Text>
                </TouchableOpacity>
              </View>
              <FlatList
                horizontal
                showsHorizontalScrollIndicator={false}
                data={staffModules}
                keyExtractor={(m) => String(m.module_id)}
                style={{ maxHeight: 44, marginBottom: 8 }}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[
                      styles.moduleChip,
                      staffModuleId === item.module_id && styles.moduleChipActive,
                    ]}
                    onPress={() => setStaffModuleId(item.module_id)}
                  >
                    <Text
                      style={[
                        styles.moduleChipText,
                        staffModuleId === item.module_id && styles.moduleChipTextActive,
                      ]}
                    >
                      {item.name}
                    </Text>
                  </TouchableOpacity>
                )}
              />
              <FlatList
                horizontal
                showsHorizontalScrollIndicator={false}
                data={["T1", "T2", "T3", "T4", "REMEDIAL", "ALL_EXAMS"]}
                keyExtractor={(t) => t}
                style={{ maxHeight: 44, marginBottom: 8 }}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[styles.moduleChip, resultUploadTest === item && styles.moduleChipActive]}
                    onPress={() => setResultUploadTest(item)}
                  >
                    <Text style={[styles.moduleChipText, resultUploadTest === item && styles.moduleChipTextActive]}>
                      {item}
                    </Text>
                  </TouchableOpacity>
                )}
              />
              {resultUploadTest !== "ALL_EXAMS" ? (
                <FlatList
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  data={staffSubjects}
                  keyExtractor={(s) => String(s.id)}
                  style={{ maxHeight: 44, marginBottom: 8 }}
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={[styles.moduleChip, String(resultUploadSubjectId) === String(item.id) && styles.moduleChipActive]}
                      onPress={() => setResultUploadSubjectId(String(item.id))}
                    >
                      <Text style={[styles.moduleChipText, String(resultUploadSubjectId) === String(item.id) && styles.moduleChipTextActive]}>
                        {item.short_name || item.name}
                      </Text>
                    </TouchableOpacity>
                  )}
                />
              ) : null}
              <View style={styles.filterRow}>
                <TouchableOpacity style={[styles.filterBtn, resultUploadMode === "subject" && styles.filterBtnActive]} onPress={() => setResultUploadMode("subject")}>
                  <Text style={[styles.filterBtnText, resultUploadMode === "subject" && styles.filterBtnTextActive]}>Subject Sheet</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.filterBtn, resultUploadMode === "compiled" && styles.filterBtnActive]} onPress={() => setResultUploadMode("compiled")}>
                  <Text style={[styles.filterBtnText, resultUploadMode === "compiled" && styles.filterBtnTextActive]}>Compiled Sheet</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.actionRow}>
                <TouchableOpacity style={styles.smallBtn} onPress={() => pickExcelFile(setResultUploadFile)}>
                  <Text style={styles.smallBtnText}>
                    {resultUploadFile ? `File: ${resultUploadFile.name}` : "Choose Result File"}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.smallBtnPrimary} onPress={doResultUpload} disabled={staffLoading}>
                  <Text style={styles.smallBtnPrimaryText}>Upload Result</Text>
                </TouchableOpacity>
              </View>
              {resultUploadMsg ? <Text style={styles.uploadMsg}>{resultUploadMsg}</Text> : null}
              <FlatList
                horizontal
                showsHorizontalScrollIndicator={false}
                data={staffResultCycles}
                keyExtractor={(c) => String(c.upload_id)}
                style={{ maxHeight: 44, marginBottom: 8 }}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[
                      styles.moduleChip,
                      staffResultUploadId === item.upload_id && styles.moduleChipActive,
                    ]}
                    onPress={() => setStaffResultUploadId(item.upload_id)}
                  >
                    <Text
                      style={[
                        styles.moduleChipText,
                        staffResultUploadId === item.upload_id && styles.moduleChipTextActive,
                      ]}
                    >
                      {item.test_name}-{item.subject_name}
                    </Text>
                  </TouchableOpacity>
                )}
              />
              <View style={styles.filterRow}>
                <TouchableOpacity style={[styles.filterBtn, resultFilter === "all" && styles.filterBtnActive]} onPress={() => setResultFilter("all")}>
                  <Text style={[styles.filterBtnText, resultFilter === "all" && styles.filterBtnTextActive]}>All</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.filterBtn, resultFilter === "current" && styles.filterBtnActive]} onPress={() => setResultFilter("current")}>
                  <Text style={[styles.filterBtnText, resultFilter === "current" && styles.filterBtnTextActive]}>Current Fail</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.filterBtn, resultFilter === "total" && styles.filterBtnActive]} onPress={() => setResultFilter("total")}>
                  <Text style={[styles.filterBtnText, resultFilter === "total" && styles.filterBtnTextActive]}>Cumulative Fail</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.filterBtn, resultFilter === "either" && styles.filterBtnActive]} onPress={() => setResultFilter("either")}>
                  <Text style={[styles.filterBtnText, resultFilter === "either" && styles.filterBtnTextActive]}>Either OR</Text>
                </TouchableOpacity>
              </View>
              {staffResultMeta ? (
                <Text style={styles.studentMeta}>
                  {staffResultMeta.test_name} - {staffResultMeta.subject_name} | Matched: {staffResultMeta.rows_matched} | Failed: {staffResultMeta.rows_failed}
                </Text>
              ) : null}
              {resultsInitialLoading && !staffResultRows.length ? (
                <View>
                  {[0, 1, 2].map((n) => (
                    <View style={styles.skeletonCard} key={`result-skeleton-${n}`}>
                      <View style={[styles.skeletonLine, { width: "62%" }]} />
                      <View style={[styles.skeletonLine, { width: "48%" }]} />
                      <View style={[styles.skeletonLine, { width: "70%" }]} />
                    </View>
                  ))}
                </View>
              ) : (
                <FlatList
                  data={staffResultRows}
                  keyExtractor={(r, idx) => `${r.enrollment || "x"}-${idx}`}
                  initialNumToRender={16}
                  windowSize={9}
                  refreshing={resultsRefreshing}
                  onRefresh={() => fetchResultRowsPage(true)}
                  onEndReachedThreshold={0.4}
                  onEndReached={() => fetchResultRowsPage(false)}
                  ListFooterComponent={
                    resultsLoadingMore ? (
                      <View style={styles.listFooter}>
                        <ActivityIndicator color={APP_COLORS.accent} size="small" />
                      </View>
                    ) : !resultsHasMore && staffResultRows.length ? (
                      <Text style={styles.listEndText}>No more records</Text>
                    ) : null
                  }
                  renderItem={({ item }) => (
                    <View style={styles.studentCard}>
                      <Text style={styles.studentName}>
                        {item.roll_no || "-"} | {item.name}
                      </Text>
                      <Text style={styles.studentMeta}>{item.enrollment} | Mentor: {item.mentor || "-"}</Text>
                      <Text style={[styles.studentMeta, item.current_fail && styles.lowText]}>
                        Current: {item.marks_current ?? "-"}
                      </Text>
                      <Text style={[styles.studentMeta, item.total_fail && styles.lowText]}>
                        Total: {item.marks_total ?? "-"}
                      </Text>
                      <Text style={styles.studentMeta}>
                        T1: {item.marks_t1 ?? "-"} | T2: {item.marks_t2 ?? "-"} | T3: {item.marks_t3 ?? "-"} | T4: {item.marks_t4 ?? "-"}
                      </Text>
                      <Text style={[styles.studentMeta, item.either_fail && styles.lowText]}>
                        {item.fail_reason || (item.either_fail ? "Fail as per rule" : "Pass")}
                      </Text>
                    </View>
                  )}
                />
              )}
              <Text style={[styles.infoTitle, { fontSize: 15, marginTop: 8 }]}>Result Report (Mentor-wise)</Text>
              <View style={styles.filterRow}>
                <TouchableOpacity style={[styles.filterBtn, resultReportFilter === "all" && styles.filterBtnActive]} onPress={() => setResultReportFilter("all")}>
                  <Text style={[styles.filterBtnText, resultReportFilter === "all" && styles.filterBtnTextActive]}>All</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.filterBtn, resultReportFilter === "completed" && styles.filterBtnActive]} onPress={() => setResultReportFilter("completed")}>
                  <Text style={[styles.filterBtnText, resultReportFilter === "completed" && styles.filterBtnTextActive]}>Completed</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.filterBtn, resultReportFilter === "pending" && styles.filterBtnActive]} onPress={() => setResultReportFilter("pending")}>
                  <Text style={[styles.filterBtnText, resultReportFilter === "pending" && styles.filterBtnTextActive]}>Pending</Text>
                </TouchableOpacity>
              </View>
              <FlatList
                data={pagedResultReportRows}
                keyExtractor={(r, idx) => `${r.mentor}-${idx}`}
                initialNumToRender={12}
                windowSize={8}
                refreshing={resultReportRefreshing}
                onRefresh={() => refreshResultReport(true)}
                renderItem={({ item }) => (
                  <View style={styles.studentCard}>
                    <Text style={styles.studentName}>{item.mentor}</Text>
                    <Text style={styles.studentMeta}>
                      Need: {item.need_call} | Done: {item.done} | Pending: {item.not_done}
                    </Text>
                    <Text style={styles.studentMeta}>
                      Received: {item.received} | Not Received: {item.not_received} | Msg: {item.msg_sent}
                    </Text>
                    <Text style={[styles.studentMeta, Number(item.completion_percent) < 100 && styles.lowText]}>
                      Completion: {item.completion_percent}%
                    </Text>
                  </View>
                )}
              />
              {pagedResultReportRows.length < filteredResultReportRows.length ? (
                <TouchableOpacity style={styles.loadMoreBtn} onPress={() => setResultReportVisible((n) => n + PAGE_SIZE)}>
                  <Text style={styles.loadMoreText}>Load More</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          )
        ) : activeTab === "control" ? (
          !staffToken ? (
            <View style={styles.infoPanel}>
              <Text style={styles.infoTitle}>Native Control Login</Text>
              <TextInput
                value={staffUser}
                onChangeText={setStaffUser}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="Username"
                style={styles.serverInput}
              />
              <TextInput
                value={staffPass}
                onChangeText={setStaffPass}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="Password"
                secureTextEntry
                style={[styles.serverInput, { marginTop: 8 }]}
              />
              <TouchableOpacity style={styles.applyBtn} onPress={doStaffLogin} disabled={staffLoading}>
                <Text style={styles.applyBtnText}>{staffLoading ? "Please wait..." : "Login"}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.studentsWrap}>
              <Text style={styles.infoTitle}>Control Summary</Text>
              <View style={styles.syncRow}>
                <Text style={styles.syncText}>{formatSync(lastSync.control)}</Text>
                <TouchableOpacity
                  style={styles.syncBtn}
                  onPress={async () => {
                    await refreshControlSummary();
                    showToast("Synced");
                  }}
                  disabled={staffLoading}
                >
                  <Text style={styles.syncBtnText}>Sync now</Text>
                </TouchableOpacity>
              </View>
              <FlatList
                horizontal
                showsHorizontalScrollIndicator={false}
                data={staffModules}
                keyExtractor={(m) => String(m.module_id)}
                style={{ maxHeight: 44, marginBottom: 8 }}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[
                      styles.moduleChip,
                      staffModuleId === item.module_id && styles.moduleChipActive,
                    ]}
                    onPress={() => setStaffModuleId(item.module_id)}
                  >
                    <Text
                      style={[
                        styles.moduleChipText,
                        staffModuleId === item.module_id && styles.moduleChipTextActive,
                      ]}
                    >
                      {item.name}
                    </Text>
                  </TouchableOpacity>
                )}
              />
              <FlatList
                horizontal
                showsHorizontalScrollIndicator={false}
                data={staffWeeks}
                keyExtractor={(w, idx) => `${w}-${idx}`}
                style={{ maxHeight: 44, marginBottom: 8 }}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[styles.moduleChip, staffWeek === item && styles.moduleChipActive]}
                    onPress={() => setStaffWeek(item)}
                  >
                    <Text style={[styles.moduleChipText, staffWeek === item && styles.moduleChipTextActive]}>
                      Week {item}
                    </Text>
                  </TouchableOpacity>
                )}
              />
              <Text style={styles.studentMeta}>Attendance Week: {staffControl.week ?? "-"}</Text>
              <Text style={[styles.infoTitle, { fontSize: 15, marginTop: 8 }]}>Attendance Mentor-wise</Text>
              <FlatList
                data={staffControl.attendance}
                keyExtractor={(r, idx) => `${r.mentor}-${idx}`}
                renderItem={({ item }) => (
                  <View style={styles.studentCard}>
                    <Text style={styles.studentName}>{item.mentor}</Text>
                    <Text style={styles.studentMeta}>
                      Students: {item.students} | Need: {item.need_call} | Done: {item.done} | Pending: {item.not_done}
                    </Text>
                    <Text style={[styles.studentMeta, item.completion_percent < 100 && styles.lowText]}>
                      Completion: {item.completion_percent}%
                    </Text>
                  </View>
                )}
              />
              <Text style={[styles.infoTitle, { fontSize: 15, marginTop: 8 }]}>
                Result Mentor-wise {staffControl.result_upload ? `(${staffControl.result_upload.test_name}-${staffControl.result_upload.subject_name})` : ""}
              </Text>
              <FlatList
                data={staffControl.result}
                keyExtractor={(r, idx) => `${r.mentor}-${idx}`}
                renderItem={({ item }) => (
                  <View style={styles.studentCard}>
                    <Text style={styles.studentName}>{item.mentor}</Text>
                    <Text style={styles.studentMeta}>
                      Need: {item.need_call} | Done: {item.done} | Pending: {item.not_done}
                    </Text>
                    <Text style={[styles.studentMeta, item.completion_percent < 100 && styles.lowText]}>
                      Completion: {item.completion_percent}%
                    </Text>
                  </View>
                )}
              />
            </View>
          )
        ) : activeTab !== "settings" ? (
          <WebView
            key={`${activeTab}-${reloadKey}`}
            source={{ uri: targetUrl }}
            style={styles.webview}
            sharedCookiesEnabled
            javaScriptEnabled
            domStorageEnabled
            startInLoadingState
            injectedJavaScript={injectedCss}
          />
        ) : (
          <View style={styles.infoPanel}>
            <Text style={styles.infoTitle}>Server URL</Text>
            <TextInput
              value={currentUrl}
              onChangeText={setCurrentUrl}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.serverInput}
            />
            <TouchableOpacity
              style={styles.applyBtn}
              onPress={() => {
                const next = currentUrl.trim().replace(/\/+$/, "");
                if (next) {
                  onChangeBase(next);
                }
              }}
            >
              <Text style={styles.applyBtnText}>Apply</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.applyBtn, { backgroundColor: "#0f4d8a", marginTop: 8 }]}
              onPress={() => setReloadKey((k) => k + 1)}
            >
              <Text style={styles.applyBtnText}>Reload Current Tab</Text>
            </TouchableOpacity>
            <Text style={[styles.infoTitle, { marginTop: 14 }]}>Quick Guide</Text>
            <Text style={styles.infoText}>1. Open any tab and login once.</Text>
            <Text style={styles.infoText}>2. Session is shared across tabs.</Text>
            <Text style={styles.infoText}>3. Use module dropdown as needed.</Text>
            <Text style={styles.infoText}>4. Use Switch to return role selector.</Text>
          </View>
        )}
      </View>

      <View style={styles.bottomTabs}>
        {roleTabs.map((t) => (
          <TabButton key={t.key} label={t.label} active={activeTab === t.key} onPress={() => setActiveTab(t.key)} />
        ))}
      </View>
      {toastVisible ? (
        <View style={styles.toastWrap}>
          <Text style={styles.toastText}>{toastMsg}</Text>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function TabButton({ label, active, onPress }) {
  return (
    <TouchableOpacity style={[styles.tabBtn, active && styles.tabBtnActive]} onPress={onPress}>
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

export default function App() {
  const [selectedRole, setSelectedRole] = useState("");
  const [apiBaseUrl, setApiBaseUrl] = useState(LIVE_API_BASE_URL);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    (async () => {
      const [savedRole, savedBase] = await Promise.all([
        AsyncStorage.getItem(ROLE_KEY),
        AsyncStorage.getItem(BASE_KEY),
      ]);
      if (savedBase) {
        setApiBaseUrl(savedBase);
      }
      if (savedRole) {
        setSelectedRole(savedRole);
      }
      setBooting(false);
    })();
  }, []);

  const setAndPersistRole = async (role) => {
    setSelectedRole(role);
    const normalized = apiBaseUrl.trim().replace(/\/+$/, "");
    await AsyncStorage.setItem(ROLE_KEY, role);
    await AsyncStorage.setItem(BASE_KEY, normalized);
    await AsyncStorage.setItem(LEGACY_MENTOR_BASE_KEY, normalized);
  };

  const setAndPersistBase = async (url) => {
    const next = String(url || "").trim().replace(/\/+$/, "");
    setApiBaseUrl(next);
    await AsyncStorage.setItem(BASE_KEY, next);
    await AsyncStorage.setItem(LEGACY_MENTOR_BASE_KEY, next);
  };

  const clearRole = async () => {
    setSelectedRole("");
    await AsyncStorage.removeItem(ROLE_KEY);
  };

  if (booting) {
    return <SafeAreaView style={styles.gatewayPage} />;
  }

  if (!selectedRole) {
    return (
      <RoleGateway
        onSelectRole={setAndPersistRole}
        apiBaseUrl={apiBaseUrl}
        setApiBaseUrl={setAndPersistBase}
      />
    );
  }

  if (selectedRole === "mentor") {
    return <LegacyMentorApp key={`mentor-${apiBaseUrl}`} />;
  }

  return (
    <RoleWebTabsApp
      role={selectedRole}
      apiBaseUrl={apiBaseUrl}
      onChangeBase={setAndPersistBase}
      onExit={clearRole}
    />
  );
}

const styles = StyleSheet.create({
  gatewayPage: {
    flex: 1,
    backgroundColor: APP_COLORS.bg,
    paddingTop: Platform.OS === "android" ? 18 : 8,
    paddingHorizontal: 14,
  },
  gatewayHeader: {
    backgroundColor: APP_COLORS.primary,
    borderRadius: 14,
    padding: 16,
    marginTop: 8,
    marginBottom: 14,
  },
  gatewayTitle: {
    color: "#fff",
    fontSize: 24,
    fontWeight: "800",
  },
  gatewaySub: {
    color: "#d9e8fb",
    marginTop: 4,
  },
  gatewayCard: {
    backgroundColor: APP_COLORS.card,
    borderWidth: 1,
    borderColor: APP_COLORS.border,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  gatewaySection: {
    color: APP_COLORS.text,
    fontWeight: "700",
    fontSize: 16,
    marginBottom: 8,
  },
  serverRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 8,
  },
  serverChip: {
    borderWidth: 1,
    borderColor: APP_COLORS.border,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
    backgroundColor: "#fff",
  },
  serverChipActive: {
    backgroundColor: APP_COLORS.primary,
    borderColor: APP_COLORS.primary,
  },
  serverChipText: {
    color: APP_COLORS.primary,
    fontWeight: "700",
  },
  serverChipTextActive: {
    color: "#fff",
  },
  serverInput: {
    borderWidth: 1,
    borderColor: APP_COLORS.border,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    color: APP_COLORS.text,
    backgroundColor: "#fff",
  },
  roleButton: {
    borderWidth: 1,
    borderColor: APP_COLORS.border,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    backgroundColor: "#fff",
  },
  roleTitle: {
    color: APP_COLORS.primaryDark,
    fontWeight: "800",
    fontSize: 16,
  },
  roleDesc: {
    color: APP_COLORS.muted,
    marginTop: 3,
  },
  portalPage: {
    flex: 1,
    backgroundColor: APP_COLORS.bg,
  },
  portalHeader: {
    backgroundColor: APP_COLORS.primary,
    paddingHorizontal: 14,
    paddingTop: Platform.OS === "android" ? 18 : 8,
    paddingBottom: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  portalTitle: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "800",
  },
  portalSub: {
    color: "#d8e9fc",
    fontSize: 12,
    marginTop: 2,
  },
  exitBtn: {
    backgroundColor: "#ffffff",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  exitBtnText: {
    color: APP_COLORS.primary,
    fontWeight: "700",
  },
  portalBody: {
    flex: 1,
    backgroundColor: APP_COLORS.bg,
  },
  webview: {
    flex: 1,
    backgroundColor: APP_COLORS.bg,
  },
  infoPanel: {
    margin: 14,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: APP_COLORS.border,
    borderRadius: 12,
    padding: 14,
  },
  infoTitle: {
    color: APP_COLORS.text,
    fontWeight: "800",
    fontSize: 16,
    marginBottom: 8,
  },
  infoText: {
    color: APP_COLORS.muted,
    marginBottom: 6,
  },
  applyBtn: {
    marginTop: 10,
    backgroundColor: APP_COLORS.accent,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  applyBtnText: {
    color: "#fff",
    fontWeight: "700",
  },
  bottomTabs: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: APP_COLORS.border,
    backgroundColor: "#fff",
    paddingHorizontal: 6,
    paddingVertical: 8,
  },
  tabBtn: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
    marginHorizontal: 2,
  },
  tabBtnActive: {
    backgroundColor: "#e8f2ff",
  },
  tabText: {
    color: APP_COLORS.muted,
    fontWeight: "700",
    fontSize: 12,
  },
  tabTextActive: {
    color: APP_COLORS.primary,
  },
  studentsWrap: {
    flex: 1,
    padding: 10,
  },
  studentsTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  smallDanger: {
    backgroundColor: "#c62828",
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  smallDangerText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 12,
  },
  moduleChip: {
    borderWidth: 1,
    borderColor: APP_COLORS.border,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginRight: 6,
    backgroundColor: "#fff",
  },
  moduleChipActive: {
    backgroundColor: APP_COLORS.primary,
    borderColor: APP_COLORS.primary,
  },
  moduleChipText: {
    color: APP_COLORS.primary,
    fontSize: 12,
    fontWeight: "700",
  },
  moduleChipTextActive: {
    color: "#fff",
  },
  studentCard: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: APP_COLORS.border,
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
  },
  studentName: {
    color: APP_COLORS.text,
    fontWeight: "700",
  },
  studentMeta: {
    color: APP_COLORS.muted,
    marginTop: 2,
    fontSize: 12,
  },
  syncText: {
    color: APP_COLORS.muted,
    fontSize: 12,
    marginBottom: 0,
    flex: 1,
  },
  syncRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  syncBtn: {
    backgroundColor: "#e8f2ff",
    borderWidth: 1,
    borderColor: "#b9d5f5",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginLeft: 8,
  },
  syncBtnText: {
    color: APP_COLORS.primary,
    fontSize: 12,
    fontWeight: "700",
  },
  toastWrap: {
    position: "absolute",
    bottom: 68,
    alignSelf: "center",
    backgroundColor: "#1c8f4f",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  toastText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
  },
  listFooter: {
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  listEndText: {
    textAlign: "center",
    color: APP_COLORS.muted,
    fontSize: 12,
    paddingVertical: 10,
  },
  skeletonCard: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: APP_COLORS.border,
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
  },
  skeletonLine: {
    height: 10,
    backgroundColor: "#e6edf6",
    borderRadius: 6,
    marginBottom: 8,
  },
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: 8,
    alignItems: "center",
  },
  smallBtn: {
    borderWidth: 1,
    borderColor: APP_COLORS.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: "#fff",
    marginRight: 6,
    marginBottom: 6,
  },
  smallBtnText: {
    color: APP_COLORS.text,
    fontSize: 12,
    maxWidth: 160,
  },
  smallBtnPrimary: {
    backgroundColor: APP_COLORS.primary,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginRight: 6,
    marginBottom: 6,
  },
  smallBtnPrimaryText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 12,
  },
  uploadMsg: {
    color: APP_COLORS.primaryDark,
    marginBottom: 8,
    fontSize: 12,
  },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },
  statCard: {
    width: "48%",
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: APP_COLORS.border,
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
  },
  statLabel: {
    color: APP_COLORS.muted,
    fontSize: 12,
  },
  statValue: {
    color: APP_COLORS.primaryDark,
    fontWeight: "800",
    fontSize: 20,
    marginTop: 3,
  },
  loadMoreBtn: {
    alignSelf: "center",
    borderWidth: 1,
    borderColor: APP_COLORS.primary,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginTop: 6,
    marginBottom: 8,
    backgroundColor: "#fff",
  },
  loadMoreText: {
    color: APP_COLORS.primary,
    fontWeight: "700",
    fontSize: 12,
  },
  lowText: {
    color: "#c62828",
    fontWeight: "700",
  },
  filterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: 8,
  },
  filterBtn: {
    borderWidth: 1,
    borderColor: APP_COLORS.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginRight: 6,
    marginBottom: 6,
    backgroundColor: "#fff",
  },
  filterBtnActive: {
    backgroundColor: APP_COLORS.primary,
    borderColor: APP_COLORS.primary,
  },
  filterBtnText: {
    color: APP_COLORS.primary,
    fontSize: 12,
    fontWeight: "700",
  },
  filterBtnTextActive: {
    color: "#fff",
  },
});
