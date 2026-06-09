import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '../server';
import { config } from '../config';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import { authMiddleware, AuthRequest } from '../middleware/auth';

const router = express.Router();

// Validation schemas
const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(1, 'Name is required').optional()
});

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required')
});

// Generate JWT token
const generateToken = (userId: string, email: string) => {
  return jwt.sign(
    { id: userId, email },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );
};

// Register new user (disabled by default for single-user self-hosted deployments)
router.post('/register', asyncHandler(async (req, res) => {
  if (!config.allowRegistration) {
    throw new AppError('Registration is disabled', 403);
  }

  const { email, password, name } = registerSchema.parse(req.body);

  // Check if user already exists
  const existingUser = await prisma.user.findUnique({
    where: { email }
  });

  if (existingUser) {
    throw new AppError('User already exists with this email', 409);
  }

  // Hash password
  const hashedPassword = await bcrypt.hash(password, 12);

  // Create user with default settings
  const user = await prisma.user.create({
    data: {
      email,
      password: hashedPassword,
      name,
      settings: {
        create: {
          currency: 'USD',
          dateFormat: 'MM/dd/yyyy',
          theme: 'cyberpunk',
          autoCategoriztion: true,
          notifications: true
        }
      }
    },
    select: {
      id: true,
      email: true,
      name: true,
      createdAt: true,
      settings: true
    }
  });

  // Create default categories
  await createDefaultCategories(user.id);

  // Generate token
  const token = generateToken(user.id, user.email);

  res.status(201).json({
    message: 'User created successfully',
    user,
    token
  });
}));

// Login user
router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);

  // Find user
  const user = await prisma.user.findUnique({
    where: { email },
    include: { settings: true }
  });

  if (!user) {
    throw new AppError('Invalid email or password', 401);
  }

  // Verify password
  const isPasswordValid = await bcrypt.compare(password, user.password);
  if (!isPasswordValid) {
    throw new AppError('Invalid email or password', 401);
  }

  // Generate token
  const token = generateToken(user.id, user.email);

  // Remove password from response
  const { password: _, ...userWithoutPassword } = user;

  res.json({
    message: 'Login successful',
    user: userWithoutPassword,
    token
  });
}));

// Get current user profile
router.get('/me', authMiddleware, asyncHandler(async (req: AuthRequest, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: {
      id: true,
      email: true,
      name: true,
      createdAt: true,
      settings: true
    }
  });

  res.json({ user });
}));

// Update user profile
router.put('/me', authMiddleware, asyncHandler(async (req: AuthRequest, res) => {
  const updateSchema = z.object({
    name: z.string().min(1).optional(),
    email: z.string().email().optional()
  });

  const data = updateSchema.parse(req.body);

  const user = await prisma.user.update({
    where: { id: req.user!.id },
    data,
    select: {
      id: true,
      email: true,
      name: true,
      createdAt: true,
      settings: true
    }
  });

  res.json({
    message: 'Profile updated successfully',
    user
  });
}));

// Update user settings
router.put('/settings', authMiddleware, asyncHandler(async (req: AuthRequest, res) => {
  const settingsSchema = z.object({
    currency: z.string().optional(),
    dateFormat: z.string().optional(),
    theme: z.string().optional(),
    autoCategoriztion: z.boolean().optional(),
    notifications: z.boolean().optional(),
    dataRetention: z.number().min(1).max(3650).optional(),
    shareAnalytics: z.boolean().optional()
  });

  const data = settingsSchema.parse(req.body);

  const settings = await prisma.userSettings.upsert({
    where: { userId: req.user!.id },
    update: data,
    create: {
      userId: req.user!.id,
      ...data
    }
  });

  res.json({
    message: 'Settings updated successfully',
    settings
  });
}));

// Create default categories for new user
async function createDefaultCategories(userId: string) {
  const defaultCategories = [
    { name: 'Food & Dining', icon: 'chef', color: '#ff6b6b' },
    { name: 'Transportation', icon: 'car', color: '#4ecdc4' },
    { name: 'Shopping', icon: 'bag', color: '#45b7d1' },
    { name: 'Entertainment', icon: 'tv', color: '#96ceb4' },
    { name: 'Bills & Utilities', icon: 'zap', color: '#feca57' },
    { name: 'Healthcare', icon: 'heart', color: '#ff9ff3' },
    { name: 'Education', icon: 'book', color: '#54a0ff' },
    { name: 'Travel', icon: 'plane', color: '#5f27cd' },
    { name: 'Income', icon: 'wallet', color: '#00d2d3' },
    { name: 'Investments', icon: 'trend', color: '#ff9f43' },
    { name: 'Subscriptions', icon: 'repeat', color: '#ee5a52' },
    { name: 'Other', icon: 'spark', color: '#a55eea' }
  ];

  await prisma.category.createMany({
    data: defaultCategories.map(cat => ({
      userId,
      ...cat,
      isSystem: true
    }))
  });
}

export default router;