import { pgTable, text, integer, timestamp, jsonb, boolean, decimal } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  username: text("username").unique().notNull(),
  password: text("password").notNull(),
  points: integer("points").notNull().default(0),
  created_at: timestamp("created_at").defaultNow().notNull(),
  avatar_url: text("avatar_url"),
  is_moderator: boolean("is_moderator").default(false),
  is_premium: boolean("is_premium").default(false),
  premium_until: timestamp("premium_until"),
  total_points_earned: integer("total_points_earned").default(0),
  rank: text("rank").default('newcomer'),
  ai_trust_score: decimal("ai_trust_score").default('0.5'),
});

export const subscriptions = pgTable("subscriptions", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  user_id: integer("user_id").notNull().references(() => users.id),
  plan_type: text("plan_type").notNull(), // 'monthly', 'yearly'
  amount: decimal("amount").notNull(),
  status: text("status").notNull(), // 'active', 'cancelled', 'expired'
  started_at: timestamp("started_at").defaultNow().notNull(),
  expires_at: timestamp("expires_at").notNull(),
  auto_renew: boolean("auto_renew").default(true),
  payment_provider: text("payment_provider").notNull(),
  payment_id: text("payment_id").notNull(),
});

export const transactions = pgTable("transactions", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  user_id: integer("user_id").notNull().references(() => users.id),
  amount: decimal("amount").notNull(),
  type: text("type").notNull(), // 'subscription', 'points_purchase', 'reward'
  status: text("status").notNull(), // 'completed', 'pending', 'failed'
  created_at: timestamp("created_at").defaultNow().notNull(),
  description: text("description"),
  payment_provider: text("payment_provider"),
  payment_id: text("payment_id"),
  metadata: jsonb("metadata").default({}),
});

export const moderation_logs = pgTable("moderation_logs", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  content_type: text("content_type").notNull(), // 'post', 'comment'
  content_id: integer("content_id").notNull(),
  user_id: integer("user_id").references(() => users.id),
  ai_score: decimal("ai_score").notNull(),
  ai_categories: text("ai_categories").array(),
  action_taken: text("action_taken"), // 'flagged', 'removed', 'approved'
  moderator_id: integer("moderator_id").references(() => users.id),
  created_at: timestamp("created_at").defaultNow().notNull(),
  notes: text("notes"),
});

export const points_transactions = pgTable("points_transactions", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  user_id: integer("user_id").notNull().references(() => users.id),
  amount: integer("amount").notNull(),
  type: text("type").notNull(), // 'earned', 'spent', 'reward', 'purchase'
  source: text("source").notNull(), // 'post', 'comment', 'subscription_bonus'
  source_id: integer("source_id"),
  created_at: timestamp("created_at").defaultNow().notNull(),
  metadata: jsonb("metadata").default({}),
});

export const guest_preferences = pgTable("guest_preferences", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  guest_id: text("guest_id").unique().notNull(),
  session_id: text("session_id").notNull(),
  guest_username: text("guest_username").notNull(),
  preferences: jsonb("preferences").notNull().default({}),
  created_at: timestamp("created_at").defaultNow().notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull(),
});

export const channels = pgTable("channels", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").unique().notNull(),
  description: text("description").notNull(),
  created_at: timestamp("created_at").defaultNow().notNull(),
  created_by: integer("created_by").notNull().references(() => users.id),
  rules: jsonb("rules").notNull().default([]),
  subscriber_count: integer("subscriber_count").notNull().default(0),
  banner_url: text("banner_url"),
  theme_color: text("theme_color"),
  is_private: boolean("is_private").default(false),
  is_premium: boolean("is_premium").default(false),
  available_flairs: jsonb("available_flairs").notNull().default([]),
  moderators: integer("moderators").array(),
  categories: text("categories").array(),
  voice_preview_url: text("voice_preview_url"),
  weekly_activity: integer("weekly_activity").default(0),
  related_channels: integer("related_channels").array(),
  ai_moderation_enabled: boolean("ai_moderation_enabled").default(true),
  premium_features: jsonb("premium_features").default({}),
});

export const channel_subscribers = pgTable("channel_subscribers", {
  channel_id: integer("channel_id").notNull().references(() => channels.id),
  user_id: integer("user_id").notNull().references(() => users.id),
  subscribed_at: timestamp("subscribed_at").defaultNow().notNull(),
  subscription_type: text("subscription_type").default('free'), // 'free', 'premium'
});

export const posts = pgTable("posts", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  user_id: integer("user_id").notNull().references(() => users.id),
  username: text("username").notNull(),
  title: text("title").notNull(),
  audio_url: text("audio_url").notNull(),
  duration: integer("duration").notNull(),
  transcript: text("transcript"),
  channel_id: integer("channel_id").references(() => channels.id),
  parent_id: integer("parent_id").references(() => posts.id),
  likes: integer("likes").array(),
  created_at: timestamp("created_at").defaultNow().notNull(),
  flair: text("flair"),
  is_pinned: boolean("is_pinned").default(false),
  is_locked: boolean("is_locked").default(false),
  view_count: integer("view_count").notNull().default(0),
  tags: text("tags").array(),
  is_premium: boolean("is_premium").default(false),
  ai_moderation_status: text("ai_moderation_status").default('pending'),
  ai_moderation_score: decimal("ai_moderation_score"),
  points_earned: integer("points_earned").default(0),
});

// Schema types
export const insertUserSchema = createInsertSchema(users);
export const selectUserSchema = createSelectSchema(users);
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = z.infer<typeof selectUserSchema>;

export const insertSubscriptionSchema = createInsertSchema(subscriptions);
export const selectSubscriptionSchema = createSelectSchema(subscriptions);
export type InsertSubscription = z.infer<typeof insertSubscriptionSchema>;
export type Subscription = z.infer<typeof selectSubscriptionSchema>;

export const insertTransactionSchema = createInsertSchema(transactions);
export const selectTransactionSchema = createSelectSchema(transactions);
export type InsertTransaction = z.infer<typeof insertTransactionSchema>;
export type Transaction = z.infer<typeof selectTransactionSchema>;

export const insertModerationLogSchema = createInsertSchema(moderation_logs);
export const selectModerationLogSchema = createSelectSchema(moderation_logs);
export type InsertModerationLog = z.infer<typeof insertModerationLogSchema>;
export type ModerationLog = z.infer<typeof selectModerationLogSchema>;

export const insertPointsTransactionSchema = createInsertSchema(points_transactions);
export const selectPointsTransactionSchema = createSelectSchema(points_transactions);
export type InsertPointsTransaction = z.infer<typeof insertPointsTransactionSchema>;
export type PointsTransaction = z.infer<typeof selectPointsTransactionSchema>;

export const insertGuestPreferencesSchema = createInsertSchema(guest_preferences);
export const selectGuestPreferencesSchema = createSelectSchema(guest_preferences);
export type InsertGuestPreferences = z.infer<typeof insertGuestPreferencesSchema>;
export type GuestPreferences = z.infer<typeof selectGuestPreferencesSchema>;

export const insertChannelSchema = createInsertSchema(channels);
export const selectChannelSchema = createSelectSchema(channels);
export type InsertChannel = z.infer<typeof insertChannelSchema>;
export type Channel = z.infer<typeof selectChannelSchema>;

export const insertPostSchema = createInsertSchema(posts);
export const selectPostSchema = createSelectSchema(posts);
export type InsertPost = z.infer<typeof insertPostSchema>;
export type Post = z.infer<typeof selectPostSchema>;
